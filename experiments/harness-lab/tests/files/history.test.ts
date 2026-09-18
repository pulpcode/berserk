import { randomUUID } from 'node:crypto';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { FILE_INPUT, FILE_OUTPUT, decodeFileInput, decodeFileOutput, fileReferenceText } from '../../src/pi/file-history.js';
import { validateHistoryEvidence } from '../../src/pi/history-evidence.js';
import { RESOURCE_ENTRY, RESULT_ENTRY } from '../../src/pi/resource-tools.js';
import type { FileOutput, FileRef } from '../../src/contracts/index.js';
const workspaceId=randomUUID(), sessionId=randomUUID(), requestId=randomUUID();
const file: FileRef={path:'result.md',name:'result.md',size:3,hash:'a'.repeat(64)};
const output: FileOutput={...file,workspaceId,sessionId,requestId,toolCallId:'call-1',downloadId:randomUUID(),createdAt:new Date().toISOString()};
const resource=(id=requestId)=>({type:'custom',customType:RESOURCE_ENTRY,data:{status:'available',workspaceId,requestId:id,instructions:[{fileId:'common',name:'common',content:'',hash:null,editable:false},{fileId:'workspace',name:'workspace',content:'',hash:null,editable:true}],skills:['synthesis','review'].map(id=>({id,name:id,description:'test',version:'1',hash:'a'.repeat(64)})),readSkills:[],editableFileIds:['workspace']}});
const call={type:'message',message:{role:'assistant',content:[{type:'toolCall',id:'call-1',name:'file_output',arguments:{path:'/workspace/result.md'}}]}};
const input={type:'custom_message',customType:FILE_INPUT,display:false,content:fileReferenceText([file]),details:{workspaceId,sessionId,requestId,files:[file]}};
const saved={type:'custom',customType:FILE_OUTPUT,data:output};
const returned={type:'message',message:{role:'toolResult',toolName:'file_output',toolCallId:'call-1',isError:false,content:[{type:'text',text:'文件已提供下载：result.md（3 字节）。'}],details:{file:output}}};
const terminal={type:'custom',customType:RESULT_ENTRY,data:{requestId,status:'succeeded'}};
const entries=(values:unknown[])=>values as SessionEntry[];
const check=(values:unknown[])=>validateHistoryEvidence(entries(values),workspaceId,sessionId);
describe('strict file history ownership and ordering',()=>{
  it('accepts genuine evidence and preserves fixed card when stop follows publication',()=>{
    expect(check([resource(),input,call,saved,returned,terminal])?.status).toBe('succeeded');
    expect(check([resource(),call,saved,{...terminal,data:{requestId,status:'cancelled'}}])?.status).toBe('cancelled');
  });
  it('rejects future/cross-request tool calls, mismatched paths and altered native success results',()=>{
    expect(()=>check([resource(),saved,call,returned,terminal])).toThrow();
    expect(()=>check([resource(randomUUID()),call,resource(),saved,returned,terminal])).toThrow();
    expect(()=>check([resource(),{...call,message:{...call.message,content:[{...call.message.content[0],arguments:{path:'other.md'}}]}},saved,returned,terminal])).toThrow();
    expect(()=>check([resource(),call,saved,{...returned,message:{...returned.message,details:{file:{...output,hash:'b'.repeat(64)}}}},terminal])).toThrow();
    expect(()=>check([resource(),call,saved,terminal])).toThrow();
  });
  it('rejects attachment entry inserted after user input, unknown fields and foreign owners',()=>{
    expect(()=>check([resource(),{type:'message',message:{role:'user',content:'hello'}},input])).toThrow();
    expect(()=>decodeFileInput({...input.details,seatId:'other'},workspaceId,sessionId)).toThrow();
    expect(()=>decodeFileInput({...input.details,sessionId:randomUUID()},workspaceId,sessionId)).toThrow();
    expect(()=>decodeFileOutput({...output,path:'../secret',name:'secret'},workspaceId,sessionId)).toThrow();
    expect(()=>decodeFileOutput({...output,workspaceId:randomUUID()},workspaceId,sessionId)).toThrow();
    expect(()=>decodeFileOutput({...output,hostPath:'/host/secret'},workspaceId,sessionId)).toThrow();
  });
});
