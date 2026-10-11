import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { ContextService } from '../src/context/service.js';
import { contextRoutes } from '../src/server/context-routes.js';
import { apiScope } from '../src/server/seat-scope.js';
import type { PiLab } from '../src/pi/lab.js';
import type { BackgroundService } from '../src/background/service.js';
import { RequestError } from '../src/contracts/errors.js';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function setup(){
 const mock=createMockContextServer({token:'query-token'});const url=await mock.listen();cleanup.push(()=>mock.close());
 const context=new ContextService({systems:[{id:'intel',name:'特情',adapter:'mock-information-http',baseUrl:`${url}/intel`,tokenEnv:'QUERY'},{id:'situation',name:'态势',adapter:'mock-situation-http',baseUrl:`${url}/situation`,tokenEnv:'QUERY',areas:[{id:'west',name:'西区'}]}],scopes:[{id:'scope',name:'资料',systemIds:['intel','situation'],seatIds:['a','b']}],simulation:{enabled:true,baseUrl:url,tokenEnv:'CONTROL',sources:[{systemId:'intel',sourceId:'intel-source'},{systemId:'situation',sourceId:'situation-source'}]}},{QUERY:'query-token',CONTROL:'control-token'});
 const app=Fastify();cleanup.push(()=>app.close());app.addHook('onRequest',async request=>{request.identity={userId:'user',username:'user',displayName:'user',seatId:String(request.headers['x-seat']??'a'),seatName:'席位',createPublicTask:false,manageModelSettings:false};});
 app.setErrorHandler((error,_,reply)=>{if(error instanceof RequestError)return reply.code(error.statusCode).send({code:error.code});return reply.code(500).send({code:'ERROR'});});
 const lab={context,access:{}} as PiLab;
 const background={config:{sources:[{sourceId:'intel-source',systemId:'intel'},{sourceId:'situation-source',systemId:'situation'}]},permission:(actor:{seatId:string})=>{if(actor.seatId!=='a')throw new RequestError('FORBIDDEN','denied',403);}} as unknown as BackgroundService;
 await contextRoutes(app,lab,apiScope({auth:{secret:'secret',sessionMs:1000}}),background,{CONTROL:'control-token'});
 return {app,mock,context};
}
it('serves public basemap config without secrets and uses seat permission for actual map reads',async()=>{
 const {app,mock,context}=await setup();
 expect(context.catalog('a').systems[1]?.areas).toEqual([{id:'west',name:'西区'}]);
 const config=await app.inject('/api/context/map-config');expect(config.json().simulationEnabled).toBe(true);expect(config.body).not.toMatch(/control-token|query-token/);
 expect((await app.inject({url:'/api/context/map-config',headers:{'x-seat':'b'}})).json().simulationEnabled).toBe(false);
 const payload={systemId:'situation',mode:'current'};
 expect((await app.inject({method:'POST',url:'/api/context/situation',payload})).statusCode).toBe(200);
 const count=mock.requests.length;
 expect((await app.inject({method:'POST',url:'/api/context/situation',headers:{'x-seat':'other'},payload})).statusCode).toBe(403);expect(mock.requests.length).toBe(count);
 expect((await app.inject({method:'POST',url:'/api/context/situation',payload:{...payload,scopeId:'scope'}})).statusCode).toBe(400);
});
it('rejects simulation controls before network without all configured grants and read permissions',async()=>{
 const {app,mock}=await setup();
 for(const seat of ['b','other'])expect((await app.inject({url:'/api/simulation',headers:{'x-seat':seat}})).statusCode).toBe(403);
 expect(mock.requests).toEqual([]);
});
it('rejects partial simulation mappings so the combined state cannot disclose another source',async()=>{
 const {context}=await setup();
 expect(()=>new ContextService({...context.config,simulation:{...context.config.simulation!,sources:[{systemId:'situation',sourceId:'situation-source'}]}},{QUERY:'query-token',CONTROL:'control-token'})).toThrow('配置无效');
});
