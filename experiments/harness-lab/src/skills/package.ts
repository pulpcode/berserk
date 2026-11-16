import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import type { SkillFileInput, SkillPackageContent, SkillPackageFile, SkillValidation } from '../contracts/skills.js';
import { capabilityDigest } from '../capabilities/service.js';
import { RequestError } from '../contracts/errors.js';
export const SKILL_SPECIFICATION_VERSION='agentskills-2026-11-15';
const defaultSkillLimits={archiveBytes:20*1024*1024,expandedBytes:100*1024*1024,files:256,resourceBytes:20*1024*1024,methodBytes:64*1024,textBytes:2*1024*1024};
const skillLimitVariables={archiveBytes:'LAB_SKILL_MAX_ARCHIVE_BYTES',expandedBytes:'LAB_SKILL_MAX_EXPANDED_BYTES',files:'LAB_SKILL_MAX_FILES',resourceBytes:'LAB_SKILL_MAX_RESOURCE_BYTES',methodBytes:'LAB_SKILL_MAX_METHOD_BYTES',textBytes:'LAB_SKILL_MAX_TEXT_BYTES'} as const;
/** Operators may tighten platform ceilings without increasing HTTP or memory bounds. */
export function loadSkillLimits(env:Readonly<Record<string,string|undefined>>):Readonly<typeof defaultSkillLimits>{
  const limits={...defaultSkillLimits};
  for(const key of Object.keys(skillLimitVariables) as Array<keyof typeof skillLimitVariables>){
    const variable=skillLimitVariables[key],raw=env[variable];if(raw===undefined)continue;
    const value=Number(raw);
    if(!/^[0-9]+$/.test(raw)||!Number.isSafeInteger(value)||value<1||value>defaultSkillLimits[key])throw new Error(`${variable}须为不超过平台默认上限的正整数。`);
    limits[key]=value;
  }
  return Object.freeze(limits);
}
export const skillLimits=loadSkillLimits(process.env);
export const fileHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const textExtensions=/\.(?:md|txt|py|js|mjs|cjs|ts|json|ya?ml|csv|xml|html?|svg|sh|toml|ini|css|sql)$/i;
export function skillPath(path:string):string {
  if(typeof path!=='string'||!path||path!==path.normalize('NFC')||Buffer.byteLength(path)>1024||path.includes('\\')||Array.from(path).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)||path.startsWith('/')||/^[a-z]:/i.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))throw new RequestError('SKILL_PATH_INVALID','技能包路径无效。');
  return path;
}
export function decodeSkillFile(input:SkillFileInput):SkillPackageFile {
  skillPath(input.path);
  if(typeof input.contentBase64!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.contentBase64))throw new RequestError('SKILL_FILE_INVALID','技能文件编码无效。');
  const bytes=Buffer.from(input.contentBase64,'base64');
  const max=input.path==='SKILL.md'?skillLimits.methodBytes:textExtensions.test(input.path)?skillLimits.textBytes:skillLimits.resourceBytes;
  if(bytes.length>max)throw new RequestError('SKILL_TOO_LARGE','技能文件超过Axon平台大小限制。',413);
  if(textExtensions.test(input.path)){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new RequestError('SKILL_FILE_INVALID','文本文件须为UTF-8。');}}
  return {...input,size:bytes.length,hash:fileHash(bytes),mediaType:textExtensions.test(input.path)?'text/plain':'application/octet-stream'};
}
export function packageContent(inputs:SkillFileInput[],requirements:Record<string,string>={}):{content:SkillPackageContent;validation:SkillValidation;packageDigest:string} {
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>skillLimits.files)throw new RequestError('SKILL_FILE_LIMIT','技能包文件数不符合Axon平台限制。',413);
  if(!requirements||Array.isArray(requirements)||typeof requirements!=='object'||Object.entries(requirements).some(([k,v])=>k.length>128||typeof v!=='string'||v.length>4096)||Object.keys(requirements).length>64)throw new RequestError('INVALID_INPUT','运行需求说明无效。');
  const files=inputs.map(decodeSkillFile).sort((a,b)=>a.path.localeCompare(b.path,'en'));
  const normalized=files.map(f=>f.path.toLocaleLowerCase('en-US'));
  if(new Set(normalized).size!==files.length||files.some(f=>files.some(p=>f.path.startsWith(p.path+'/'))))throw new RequestError('SKILL_PATH_DUPLICATE','技能包存在重名路径或文件目录冲突。');
  if(files.reduce((n,f)=>n+f.size,0)>skillLimits.expandedBytes)throw new RequestError('SKILL_TOO_LARGE','技能包展开后超过Axon平台限制。',413);
  const issues:SkillValidation['issues']=[];let metadata:Record<string,unknown>={};let name='',description='';
  const method=files.find(f=>f.path==='SKILL.md');
  if(!method)issues.push({code:'SKILL_MD_REQUIRED',path:'SKILL.md',severity:'error',message:'技能根须包含SKILL.md。'});
  else {
    const raw=Buffer.from(method.contentBase64,'base64').toString('utf8');const front=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
    if(!front)issues.push({code:'FRONTMATTER_REQUIRED',path:'SKILL.md',severity:'error',message:'SKILL.md须包含YAML元数据。'});
    else {
      try{const doc=parseDocument(front[1],{uniqueKeys:true});if(doc.errors.length)throw Error();const value:unknown=doc.toJS({maxAliasCount:0});if(!value||typeof value!=='object'||Array.isArray(value))throw Error();metadata=value as Record<string,unknown>;}catch{issues.push({code:'YAML_INVALID',path:'SKILL.md',severity:'error',message:'YAML元数据无效或含重复键。'});}
      if(typeof metadata.name==='string')name=metadata.name;
      if(typeof metadata.description==='string')description=metadata.description;
      if(!/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(name)||name.toLowerCase()!==name||Array.from(name).length>64)issues.push({code:'NAME_INVALID',severity:'error',path:'SKILL.md',message:'name须为1至64个小写字母、数字或单连字符，可使用Unicode字符。'});
      if(!description.trim()||Array.from(description).length>1024)issues.push({code:'DESCRIPTION_INVALID',severity:'error',path:'SKILL.md',message:'description须为非空且不超过1024字符。'});
      for(const key of ['license','compatibility','allowed-tools'])if(metadata[key]!==undefined&&typeof metadata[key]!=='string')issues.push({code:'FIELD_TYPE',severity:'error',path:'SKILL.md',message:`${key}须为字符串。`});
      if(typeof metadata.compatibility==='string'&&Array.from(metadata.compatibility).length>500)issues.push({code:'COMPATIBILITY_LENGTH',severity:'error',path:'SKILL.md',message:'compatibility不能超过500字符。'});
      if(metadata.metadata!==undefined&&(!metadata.metadata||Array.isArray(metadata.metadata)||typeof metadata.metadata!=='object'||Object.values(metadata.metadata).some(v=>typeof v!=='string')))issues.push({code:'METADATA_INVALID',severity:'error',path:'SKILL.md',message:'metadata须为字符串键值映射。'});
      if(!raw.slice(front[0].length).trim())issues.push({code:'AXON_EMPTY_BODY',severity:'warning',path:'SKILL.md',message:'Axon提示：技能正文为空。'});
      if(raw.split('\n').length>500)issues.push({code:'BODY_LENGTH_ADVICE',severity:'info',path:'SKILL.md',message:'建议正文保持简短并将详细材料移到资源文件。'});
    }
  }
  const extensions=Object.keys(metadata).filter(k=>!['name','description','license','compatibility','metadata','allowed-tools'].includes(k));
  for(const key of extensions)issues.push({code:'EXTENSION_UNSUPPORTED',severity:'warning',path:'SKILL.md',message:`扩展字段${key}原文保留，Axon不自动应用其调用或权限配置。`});
  for(const file of files.filter(f=>/\.md$/i.test(f.path))){
    const text=Buffer.from(file.contentBase64,'base64').toString('utf8');
    for(const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)){
      const ref=match[1].replace(/^<|>$/g,'');if(!ref||ref.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(ref)||ref.startsWith('//'))continue;
      let path:string;try{path=decodeURIComponent(ref.split(/[?#]/)[0]);}catch{path='\0';}
      const target=posix.normalize(posix.join(posix.dirname(file.path),path));
      if(path.startsWith('/')||target.startsWith('../')||target==='..'||!files.some(f=>f.path===target||f.path.startsWith(target+'/')))issues.push({code:'PACKAGE_REFERENCE_MISSING',severity:'error',path:file.path,message:`包内引用不存在或越界：${ref}`});
    }
  }
  const autoInvocationEligible=!extensions.some(k=>['disable-model-invocation','user-invocable','context','agent','hooks'].includes(k))&&!files.some(f=>f.path==='agents/openai.yaml');
  const content:SkillPackageContent={schemaVersion:2,name,description,files,requirements:{...requirements},autoInvocationEligible};
  const packageDigest=capabilityDigest({...content,files:files.map(({path,size,hash,mediaType})=>({path,size,hash,mediaType}))});
  return {content,packageDigest,validation:{valid:!issues.some(i=>i.severity==='error'),packageDigest,issues,extensions,specificationVersion:SKILL_SPECIFICATION_VERSION,checkedAt:new Date().toISOString()}};
}
