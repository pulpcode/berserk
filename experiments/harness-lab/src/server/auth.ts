import cookie from '@fastify/cookie';
import session, { type SessionStore } from '@fastify/session';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, Session } from 'fastify';
import type { Identity, AuthSession } from '../contracts/access.js';
import type { AccessStore } from '../access/store.js';
import { RequestError } from '../contracts/errors.js';

declare module 'fastify' {
  interface Session { userId?: string; csrf?: string; viewId?: string; expiresAt?: number }
  interface FastifyRequest { identity?: Identity; authValid?: () => boolean }
}
const unauthorized = () => new RequestError('AUTH_REQUIRED','请登录后继续。',401);
export async function registerAuth(app: FastifyInstance, access: AccessStore, config: {secret:string;sessionMs:number}) {
  const db = access.db;
  const store: SessionStore = {
    set(id, value, callback) {
      try {
        // Absolute expiry is never extended by traffic or plugin touch().
        const expires = value.expiresAt ?? Date.now() + config.sessionMs;
        db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,expires=excluded.expires,data=excluded.data').run(id,value.userId ?? null,expires,JSON.stringify({...value,expiresAt:expires})); callback();
      } catch(error) { callback(error); }
    },
    get(id, callback) {
      try {
        const row = db.prepare('SELECT data FROM auth_sessions WHERE id=? AND expires>?').get(id,Date.now());
        callback(null,row ? JSON.parse(String(row.data)) as Session : null);
      } catch(error) { callback(error); }
    },
    destroy(id, callback) { try { db.prepare('DELETE FROM auth_sessions WHERE id=?').run(id); callback(); } catch(error) { callback(error); } },
  };
  await app.register(cookie);
  await app.register(session, {secret:config.secret,cookieName:'axon.session',saveUninitialized:false,rolling:false,store,
    cookie:{httpOnly:true,sameSite:'strict',secure:false,path:'/',maxAge:config.sessionMs}});
  app.decorateRequest('identity', undefined);
  app.decorateRequest('authValid', undefined);
  const attempts = new Map<string,{count:number;until:number}>(); let checking = 0;
  const throttle = (key:string) => {
    const now=Date.now(); for(const [id,entry] of attempts) if(entry.until<=now) attempts.delete(id);
    const entry=attempts.get(key) ?? {count:0,until:now+60000}; entry.count++; attempts.set(key,entry);
    if(entry.count>8) throw new RequestError('LOGIN_LIMIT','尝试次数较多，请一分钟后重试。',429);
  };
  const result = (request: FastifyRequest): AuthSession => ({mode:'login',csrf:request.session.csrf,viewId:request.session.viewId,
    ...(request.identity ? {identity:request.identity,seats:access.seats()} : {})});
  app.addHook('onRequest', async request => {
    const path=request.url.split('?')[0];
    if(!path.startsWith('/api/')) return;
    // Only explicitly registered source routes use their own Bearer authentication.
    if(request.routeOptions.config.axonSource === true) return;
    const authRoute=path.startsWith('/api/auth/');
    if(request.session.userId && (request.session.expiresAt ?? 0)>Date.now()) request.identity=access.identity(request.session.userId);
    if(!authRoute && path!=='/api/health' && !request.identity) throw unauthorized();
    if(!['GET','HEAD','OPTIONS'].includes(request.method)) {
      if(!request.headers.origin || !request.session.csrf || request.headers['x-csrf-token']!==request.session.csrf) throw new RequestError('CSRF_REJECTED','页面已过期，请刷新后再试。',403);
      if(!authRoute && request.headers['x-axon-view']!==request.session.viewId) throw new RequestError('IDENTITY_CHANGED','登录身份已变化，请重新进入工作台。',409);
    } else if(request.headers['x-axon-view'] && request.headers['x-axon-view']!==request.session.viewId) throw new RequestError('IDENTITY_CHANGED','登录身份已变化。',409);
    const id=request.session.sessionId, userId=request.session.userId;
    request.authValid=()=>Boolean(userId && access.identity(userId) && db.prepare('SELECT id FROM auth_sessions WHERE id=? AND user_id=? AND expires>?').get(id,userId,Date.now()));
  });
  app.get('/api/auth/session', async request => {
    request.session.csrf ??= randomBytes(32).toString('hex');
    request.session.viewId ??= randomBytes(24).toString('hex');
    request.session.expiresAt ??= Date.now()+config.sessionMs;
    return result(request);
  });
  app.post<{Body:{username:string;password:string}}>('/api/auth/login',{schema:{body:{type:'object',additionalProperties:false,required:['username','password'],properties:{username:{type:'string',minLength:1,maxLength:64},password:{type:'string',minLength:1,maxLength:256}}}}},async request => {
    throttle(`ip:${request.ip}`); throttle(`account:${request.body.username}`);
    if(checking>=2) throw new RequestError('LOGIN_LIMIT','登录服务忙，请稍后重试。',429);
    checking++; let identity:Identity|undefined;
    try {identity=await access.authenticate(request.body.username,request.body.password);} finally {checking--;}
    if(!identity) throw new RequestError('INVALID_CREDENTIALS','账号或密码不正确。',401);
    await request.session.regenerate();
    request.session.userId=identity.userId; request.session.csrf=randomBytes(32).toString('hex'); request.session.viewId=randomBytes(24).toString('hex'); request.session.expiresAt=Date.now()+config.sessionMs;
    request.identity=identity; return result(request);
  });
  app.post('/api/auth/logout', async request => {
    // Rotate once before notifying other tabs, so they share the same anonymous
    // session instead of racing to set different cookies and CSRF tokens.
    await request.session.regenerate();
    request.session.csrf=randomBytes(32).toString('hex');
    request.session.viewId=randomBytes(24).toString('hex');
    request.session.expiresAt=Date.now()+config.sessionMs;
    request.identity=undefined;
    return result(request);
  });
  const cleanup=setInterval(()=>db.prepare('DELETE FROM auth_sessions WHERE expires<=?').run(Date.now()),60000); cleanup.unref();
  app.addHook('onClose',async()=>clearInterval(cleanup));
}
export function identityOf(request: FastifyRequest): Identity { if(!request.identity) throw unauthorized(); return request.identity; }
