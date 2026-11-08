import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { CommandReceipt, ExternalCommand } from '../../../src/contracts/commands.js';
import { RequestError } from '../../../src/contracts/errors.js';
import { commandHash, commandInput, stableCommand, assertCommandObjects } from '../../../src/commands/validation.js';
import { contextRecord, contextText } from '../../../src/context/validation.js';
import { ScenarioStore, sceneError } from './store.js';

/** Receives instructions only. Receipt persistence never mutates source facts or clock. */
export function scenarioCommands(store: ScenarioStore, path?: string) {
  const db = new DatabaseSync(path ?? ':memory:');
  db.exec('PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS scenario_commands(id TEXT PRIMARY KEY,input TEXT NOT NULL,receipt TEXT NOT NULL);');
  const read = (id: string) => db.prepare('SELECT input,receipt FROM scenario_commands WHERE id=?').get(id);
  return {
    close() { db.close(); },
    async handle(req: IncomingMessage, url: URL) {
      if (url.search) throw sceneError('指令接口不接受查询参数。', 'INVALID_ARGUMENT', 400);
      const executionMatch = /^\/control\/commands\/([0-9a-f-]{36})\/execution$/.exec(url.pathname);
      if (req.method === 'GET' && executionMatch) {
        const execution = store.commandExecution(executionMatch[1]);
        if (!execution) throw sceneError('没有该指令的执行记录。', 'NOT_FOUND', 404);
        return execution;
      }
      const match = /^\/control\/commands\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (req.method === 'GET' && match) {
        const current = store.command(match[1]);
        if (current) return current.command.receipt;
        const row = read(match[1]);
        if (!row) throw sceneError('尚无该指令的接收回执。', 'NOT_FOUND', 404);
        return JSON.parse(String(row.receipt)) as CommandReceipt;
      }
      if (req.method !== 'POST' || url.pathname !== '/control/commands') throw sceneError('指令接口不存在。', 'NOT_FOUND', 404);
      let text = '', bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 32768) throw sceneError('指令内容过大。', 'INVALID_ARGUMENT', 400);
        text += chunk;
      }
      let input: ExternalCommand;
      try {
        const raw = contextRecord(JSON.parse(text), ['commandId', 'scenarioInstanceId', 'taskId', 'issuedBy', 'command', 'contentHash'], ['commandId', 'scenarioInstanceId', 'taskId', 'issuedBy', 'command', 'contentHash']);
        const issuedBy = contextRecord(raw.issuedBy, ['seatId', 'seatName'], ['seatId', 'seatName']);
        const command = commandInput(raw.command);
        if (command.attachmentFileId !== undefined) throw sceneError('外部接口只接收执行内容。', 'INVALID_ARGUMENT', 400);
        input = { commandId: contextText(raw.commandId, 36), scenarioInstanceId: contextText(raw.scenarioInstanceId, 64),
          taskId: contextText(raw.taskId, 36), issuedBy: { seatId: contextText(issuedBy.seatId, 64), seatName: contextText(issuedBy.seatName, 100) },
          command, contentHash: contextText(raw.contentHash, 64) };
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof RequestError && ['CONTEXT_INVALID_ARGUMENT', 'INVALID_INPUT'].includes(error.code)) {
          throw sceneError('指令内容无效，请核对车辆、目的地和路线。', 'INVALID_ARGUMENT', 400);
        }
        throw error;
      }
      const command = input.command;
      if (!/^[0-9a-f-]{36}$/.test(input.commandId) || !/^[0-9a-f-]{36}$/.test(input.taskId) || commandHash(command) !== input.contentHash) throw sceneError('指令编号或内容校验失败。', 'INVALID_ARGUMENT', 400);
      const prior = store.command(input.commandId);
      if (prior || ['5', '6'].includes(store.get(input.scenarioInstanceId).instance.definitionVersion)) {
        try { return store.receiveCommand(input); }
        catch(error) {
          if(error instanceof RequestError && error.code==='INVALID_INPUT')throw sceneError(error.message,'INVALID_ARGUMENT',400);
          throw error;
        }
      }
      const encoded = stableCommand(input);
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = read(input.commandId);
        if (previous) {
          if (previous.input !== encoded) throw sceneError('指令编号已用于其他内容。', 'ACTION_CONFLICT', 409);
          db.exec('COMMIT');
          return JSON.parse(String(previous.receipt)) as CommandReceipt;
        }
        const record = store.get(input.scenarioInstanceId);
        if (store.active().instanceId !== input.scenarioInstanceId || record.instance.status !== 'active') throw sceneError('原演示已结束，未接收新指令。', 'SCENARIO_FROZEN', 409);
        assertCommandObjects(command, record.objects);
        const receipt: CommandReceipt = { commandId: input.commandId, receiptId: randomUUID(), status: 'received', receivedAt: new Date().toISOString(), contentHash: input.contentHash };
        db.prepare('INSERT INTO scenario_commands VALUES(?,?,?)').run(input.commandId, encoded, JSON.stringify(receipt));
        db.exec('COMMIT');
        return receipt;
      } catch (error) {
        db.exec('ROLLBACK');
        if (error instanceof RequestError && error.code === 'INVALID_INPUT') throw sceneError(error.message, 'INVALID_ARGUMENT', 400);
        throw error;
      }
    },
  };
}
