import { appendFileSync } from 'node:fs';
const expected='https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions';
if(process.env.LLM_PROVIDER!=='volcengine-agent-plan'||process.env.LLM_BASE_URL!=='https://ark.cn-beijing.volces.com/api/plan/v3'||process.env.LLM_MODEL!=='deepseek-v4.1-flash')throw Error('Provider configuration mismatch');
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=String(typeof input==='string'||input instanceof URL?input:input.url);const u=new URL(url);
 if(['127.0.0.1','localhost','[::1]'].includes(u.hostname))return original(input,init);
 if(url!==expected)throw Error('Unexpected external request blocked: '+u.origin+u.pathname);
 const body=JSON.parse(init?.body??'{}');if(body.model!==process.env.LLM_MODEL)throw Error('Unexpected model');
 const entry={at:new Date().toISOString(),url,model:body.model,stream:body.stream??false};
 try {const response=await original(input,{...init,redirect:'error'});Object.assign(entry,{responseUrl:response.url,status:response.status,requestId:response.headers.get('x-request-id')??response.headers.get('x-tt-logid')});if(response.url!==expected)throw Error('Unexpected response URL');return response;}
 finally{appendFileSync(process.env.PROVIDER_AUDIT_PATH,JSON.stringify(entry)+'\n',{mode:0o600});}
};
