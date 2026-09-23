import Parser from 'tree-sitter';
import Bash from 'tree-sitter-bash';
import { posix } from 'node:path';

export interface CommandDecision { decision: 'allow' | 'ask' | 'deny'; ruleId: string; reason: string; version: string }
export const COMMAND_POLICY_VERSION = 'axon-bash-v2';
const denied = new Set(['sudo', 'su', 'doas', 'mount', 'umount', 'nsenter', 'chroot']);
const destructive = new Set(['rm', 'rmdir', 'unlink', 'shred', 'truncate', 'chmod', 'chown', 'chgrp']);
const shells = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh', 'fish']);
const delegates = new Set(['eval', 'source', '.', 'exec', 'builtin', 'time', 'timeout', 'xargs', 'nice', 'nohup', 'watch', 'setsid', 'chrt', 'taskset']);
const interpreters = new Set(['perl', 'ruby', 'php', 'awk', 'gawk', 'mawk', 'lua', 'Rscript']);
const filenameGlobCommands = new Set(['ls', 'md5sum', 'sha256sum', 'wc']);
const score = { allow: 0, ask: 1, deny: 2 };
const result = (decision: CommandDecision['decision'], ruleId: string, reason: string): CommandDecision => ({ decision, ruleId, reason, version: COMMAND_POLICY_VERSION });
const unknown = () => result('ask', 'shell.review', '该命令含未支持或无法可靠分析的语法，需要人工检查。');
let parser: Parser | undefined;

/** Decode literals only. Never expand variables, run a shell, or read/source a file. */
function literal(node: Parser.SyntaxNode): string | undefined {
  if (node.type === 'command_name') return node.namedChildren.length === 1 ? literal(node.namedChildren[0]) : undefined;
  if (node.type === 'raw_string') return node.text.slice(1, -1);
  if (node.type === 'concatenation') {
    const parts = node.namedChildren.map(literal);
    return parts.every((part): part is string => part !== undefined) ? parts.join('') : undefined;
  }
  if (!['word', 'number', 'string'].includes(node.type)) return undefined;
  if (node.type === 'string' && node.namedChildren.some(child => child.type !== 'string_content')) return undefined;
  const quoted = node.type === 'string';
  const text = quoted ? node.text.slice(1, -1) : node.text;
  let value = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') {
      const next = text[++i];
      if (next === undefined) return undefined;
      if (next === '\n') continue;
      value += quoted && !['$', '`', '"', '\\'].includes(next) ? `\\${next}` : next;
    } else {
      if (['$', '`'].includes(char) || (!quoted && '*?[]{}~'.includes(char))) return undefined;
      value += char;
    }
  }
  return value;
}

/** Only a basename pattern for ordinary file inspection, not a shell expansion. */
function simpleFilenameGlob(node: Parser.SyntaxNode): string | undefined {
  return node.type === 'word' && !node.text.startsWith('-') && /[*?]/.test(node.text)
    && /^[\p{L}\p{N}._*?-]+$/u.test(node.text) ? node.text : undefined;
}

function commandRule(input: string[]): CommandDecision {
  const words = [...input];
  // Handle only literal assignments and the simple forms of these wrappers.
  for (let depth = 0; depth < input.length; depth++) {
    const name = posix.basename(words[0] ?? '');
    if (name === 'env') {
      words.shift();
      if (words[0] === '--') words.shift();
      // env accepts literal names beyond shell assignment identifiers. Its
      // option terminator precedes assignments, rather than following them.
      if (words[0]?.startsWith('-')) return unknown();
      while (words[0]?.includes('=')) words.shift();
      if (!words.length || words[0].startsWith('-')) return unknown();
    } else if (name === 'command') {
      words.shift();
      if (words[0] === '--') words.shift();
      if (!words.length || words[0].startsWith('-')) return unknown();
    } else break;
  }
  const name = posix.basename(words[0] ?? '');
  const args = words.slice(1);
  if (!name) return unknown();
  if (denied.has(name)) return result('deny', 'shell.environment', '本期不允许提权或切换执行环境；请在当前沙盒权限内完成任务。');
  if (destructive.has(name)) return result('ask', 'shell.modify', `${name} 可能删除、截断文件或修改文件权限／归属，请确认完整命令。`);
  if (shells.has(name) || /\.(?:sh|bash|zsh|ksh)$/.test(name) || delegates.has(name) || interpreters.has(name)) return unknown();
  if (['cd', 'pushd', 'popd'].includes(name)
    && !(words[0] === 'cd' && args.length === 1 && ['/workspace', '.'].includes(args[0]))) return unknown();
  if (/^python(?:\d+(?:\.\d+)*)?$/.test(name) || ['node', 'nodejs'].includes(name)) {
    // Ordinary file scripts stay usable; their contents are explicitly not audited.
    if (!args.length || args[0].startsWith('-')) return unknown();
  }
  if (name === 'git') {
    let i = 0;
    for (; i < args.length && args[i].startsWith('-'); i++) {
      const arg = args[i];
      if (arg === '-C' || arg === '-c') { if (!args[++i]) return unknown(); }
      else if (/^-[Cc].+/.test(arg)) continue;
      else if (['--no-pager', '--paginate', '--literal-pathspecs', '--no-optional-locks'].includes(arg)) continue;
      else return unknown();
    }
    const subcommand = args[i];
    if (['clean', 'restore'].includes(subcommand) || (subcommand === 'reset' && args.slice(i + 1).some(arg => /^--hard(?:=|$)/.test(arg)))) {
      return result('ask', 'git.overwrite', '该 Git 命令可能清理或覆盖工作区内容，请确认完整命令。');
    }
    if (subcommand === 'reset' && args.slice(i + 1).some(arg => arg.startsWith('-') && !['--soft', '--mixed', '--keep', '--merge', '--', '-q', '--quiet'].includes(arg))) return unknown();
  }
  return result('allow', 'shell.ordinary', '可分析的普通命令，在既有 Docker 沙盒中执行。');
}

/** Policy is an entry check, not a semantic audit of executable/script contents.
 * Infrastructure errors deliberately escape: the host must terminate, not ask/allow. */
export function evaluateCommand(command: string, cwd = '/workspace'): CommandDecision {
  if (typeof command !== 'string' || !command.trim() || command.includes('\0')) return unknown();
  parser ??= new Parser();
  parser.setLanguage(Bash);
  const tree = parser.parse(command);
  if (!tree) throw new Error('命令解析器未返回语法树。');
  let decision = result('allow', 'shell.ordinary', '可分析的普通命令，在既有 Docker 沙盒中执行。');
  const merge = (next: CommandDecision) => { if (score[next.decision] > score[decision.decision]) decision = next; };
  if (tree.rootNode.hasError || cwd !== '/workspace') merge(unknown());
  const visit = (node: Parser.SyntaxNode) => {
    if (node.isMissing || node.type === 'ERROR') merge(unknown());
    switch (node.type) {
      case 'program': case 'list': case 'pipeline':
        if (node.children.some(child => !child.isNamed && ![';', '&&', '||', '|', '|&', '\n'].includes(child.type))) merge(unknown());
        for (const child of node.namedChildren) visit(child);
        return;
      case 'comment': return;
      case 'command': {
        const words: string[] = [];
        const name = node.childForFieldName('name');
        const executable = name && literal(name);
        const allowFilenameGlobs = executable !== null && executable !== undefined && filenameGlobCommands.has(posix.basename(executable));
        // The grammar can split a word around a skipped escaped newline.
        // Such fragments are not separate argv entries in Bash.
        for (let i = 1; i < node.namedChildren.length; i++) {
          const previous = node.namedChildren[i - 1];
          const child = node.namedChildren[i];
          const gap = command.slice(previous.endIndex, child.startIndex);
          if (gap.includes('\\\n') && !gap.replaceAll('\\\n', '')) merge(unknown());
        }
        for (const child of node.namedChildren) {
          if (child.type === 'variable_assignment') {
            const name = child.childForFieldName('name');
            const value = child.childForFieldName('value');
            if (name?.type !== 'variable_name' || (value && literal(value) === undefined)) {
              merge(unknown());
              for (const nested of child.descendantsOfType('command')) visit(nested);
            }
            continue;
          }
          const value = literal(child) ?? (allowFilenameGlobs && child !== name ? simpleFilenameGlob(child) : undefined);
          if (value === undefined) {
            merge(unknown());
            // Known nested invocations still take precedence, e.g. sudo inside $(...).
            for (const nested of child.descendantsOfType('command')) visit(nested);
          } else words.push(value);
        }
        // Do not shift arguments into the executable position when its name was dynamic.
        if (executable !== null && executable !== undefined) merge(commandRule(words));
        else merge(unknown());
        return;
      }
      case 'redirected_statement':
        for (const child of node.namedChildren) visit(child);
        return;
      case 'file_redirect': {
        const target = node.childForFieldName('destination');
        // Redirection operands may themselves invoke commands before the
        // outer command runs; retain deny precedence for those invocations.
        for (const nested of node.descendantsOfType('command')) visit(nested);
        const value = target && literal(target);
        const operator = node.children.find(child => !child.isNamed)?.type;
        if (value !== undefined && value !== null && ['>&', '<&'].includes(operator ?? '') && /^\d+$/.test(value)) return;
        if (!operator || !['>', '>>', '<', '<>', '>|', '&>', '&>>'].includes(operator) || value === undefined || value === null) { merge(unknown()); return; }
        const path = posix.resolve(cwd, value);
        if (!value || value.split('/').includes('..') || !(path === '/workspace' || path.startsWith('/workspace/') || path === '/tmp' || path.startsWith('/tmp/') || path === '/dev/null')) merge(unknown());
        return;
      }
      default:
        merge(unknown());
        for (const child of node.namedChildren) visit(child);
    }
  };
  visit(tree.rootNode);
  return decision;
}
