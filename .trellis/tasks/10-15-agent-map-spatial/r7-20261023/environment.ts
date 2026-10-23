import assert from 'node:assert/strict';
export const endpoint='https://ark.cn-beijing.volces.com/api/plan/v3';
export const model='deepseek-v4.1-flash';
export function liveEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv{
 assert.ok(env.LLM_API_KEY?.trim(),'Missing configured API key');
 assert.equal(env.LLM_BASE_URL,endpoint,'Only approved Agent Plan endpoint allowed');
 assert.equal(env.LLM_MODEL,model,'Only approved Flash model allowed');
 return {...env,LLM_PROVIDER:'volcengine-agent-plan',LLM_MODEL:model,LLM_BASE_URL:endpoint,LLM_CONTEXT_WINDOW:'1048576',LLM_MAX_OUTPUT_TOKENS:'8192',LLM_REQUEST_TIMEOUT_MS:'300000',LLM_HTTP_IDLE_TIMEOUT_MS:'300000',AGENT_RUN_TIMEOUT_MS:'0',LAB_EXECUTION_ENABLED:'false',LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined};
}
export function offlineEnvironment(){return liveEnvironment({...process.env,LLM_API_KEY:'offline-placeholder',LLM_BASE_URL:endpoint,LLM_MODEL:model});}
