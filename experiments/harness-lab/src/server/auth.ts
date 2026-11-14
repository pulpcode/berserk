import cookie from '@fastify/cookie';
import session, { type SessionStore } from '@fastify/session';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, Session } from 'fastify';
import { isBusinessIdentity, type AccountIdentity, type Identity, type AuthSession } from '../contracts/access.js';
import type { AccessStore } from '../access/store.js';
import { RequestError } from '../contracts/errors.js';

declare module 'fastify' {
  interface Session { userId?: string; csrf?: string; viewId?: string; expiresAt?: number }
  interface FastifyRequest { identity?: Identity; accountIdentity?: AccountIdentity; workspaceIdentity?: Identity; authValid?: () => boolean }
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
  app.decorateRequest('accountIdentity', undefined);
  app.decorateRequest('workspaceIdentity', undefined);
  app.decorateRequest('authValid', undefined);
  const attempts = new Map<string,{count:number;until:number}>(); let checking = 0;
  const throttle = (key:string) => {
    const now=Date.now(); for(const [id,entry] of attempts) if(entry.until<=now) attempts.delete(id);
    const entry=attempts.get(key) ?? {count:0,until:now+60000}; entry.count++; attempts.set(key,entry);
    if(entry.count>8) throw new RequestError('LOGIN_LIMIT','尝试次数较多，请一分钟后重试。',429);
  };
  const result = (request: FastifyRequest): AuthSession => {
    const users = request.accountIdentity ? [] : access.loginUsers();
    return {mode:'login',csrf:request.session.csrf,viewId:request.session.viewId,
      ...(request.accountIdentity ? {identity:request.accountIdentity,seats:request.identity ? access.businessSeats() : []} : {
        loginSeats:access.seats().map(({id,name})=>({id,name})),...(users.length ? {loginUsers:users} : {}),
      })};
  };
  app.addHook('onRequest', async request => {
    const path=request.url.split('?')[0];
    if(!path.startsWith('/api/')) return;
    // Only explicitly registered source routes use their own Bearer authentication.
    if(request.routeOptions.config.axonSource === true) return;
    const authRoute=path.startsWith('/api/auth/');
    if(request.session.userId && (request.session.expiresAt ?? 0)>Date.now()) {
      request.accountIdentity=access.accountIdentity(request.session.userId);
      request.workspaceIdentity=access.workspaceIdentity(request.session.userId);
      if(request.accountIdentity && isBusinessIdentity(request.accountIdentity)) request.identity=request.accountIdentity;
    }
    if(!authRoute && path!=='/api/health' && !request.accountIdentity) throw unauthorized();
    const personalPath = path === '/api/info' || path === '/api/models' || path === '/api/activity'
      || /^\/api\/(?:workspaces|tasks|sessions)(?:\/|$)/.test(path)
      || /^\/api\/capabilities\/(?:access|library|experts)(?:\/|$)/.test(path);
    if(request.accountIdentity && !request.identity && !authRoute && path!=='/api/health'
      && !path.startsWith('/api/admin/') && !personalPath) {
      throw new RequestError('FORBIDDEN','管理员账号不能访问业务工作台。',403);
    }
    if(!['GET','HEAD','OPTIONS'].includes(request.method)) {
      if(!request.headers.origin || !request.session.csrf || request.headers['x-csrf-token']!==request.session.csrf) throw new RequestError('CSRF_REJECTED','页面已过期，请刷新后再试。',403);
      if(!authRoute && request.headers['x-axon-view']!==request.session.viewId) throw new RequestError('IDENTITY_CHANGED','登录身份已变化，请重新进入工作台。',409);
    } else if(request.headers['x-axon-view'] && request.headers['x-axon-view']!==request.session.viewId) throw new RequestError('IDENTITY_CHANGED','登录身份已变化。',409);
    const id=request.session.sessionId, userId=request.session.userId;
    request.authValid=()=>Boolean(userId && access.accountIdentity(userId) && db.prepare('SELECT id FROM auth_sessions WHERE id=? AND user_id=? AND expires>?').get(id,userId,Date.now()));
  });
  app.get('/api/auth/session', async request => {
    request.session.csrf ??= randomBytes(32).toString('hex');
    request.session.viewId ??= randomBytes(24).toString('hex');
    request.session.expiresAt ??= Date.now()+config.sessionMs;
    return result(request);
  });
  app.post<{Body:{username?:string;seatId?:string;accountId?:string;password:string}}>('/api/auth/login',{schema:{body:{type:'object',additionalProperties:false,required:['password'],oneOf:[{required:['username']},{required:['seatId']},{required:['accountId']}],properties:{username:{type:'string',minLength:1,maxLength:64},seatId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,64}$'},accountId:{type:'string',format:'uuid'},password:{type:'string',minLength:1,maxLength:256}}}}},async request => {
    throttle(`ip:${request.ip}`);
    const username=request.body.seatId ? access.identityForSeat(request.body.seatId)?.username ?? ''
      : request.body.accountId ? access.identityForLoginUser(request.body.accountId)?.username ?? '' : request.body.username!;
    throttle(`account:${username || (request.body.accountId ? `unknown-account:${request.body.accountId}` : `unknown-seat:${request.body.seatId}`)}`);
    if(checking>=2) throw new RequestError('LOGIN_LIMIT','登录服务忙，请稍后重试。',429);
    checking++; let identity:AccountIdentity|undefined;
    try {identity=await access.authenticate(username,request.body.password);} finally {checking--;}
    if(!identity) throw new RequestError('INVALID_CREDENTIALS',request.body.seatId ? '席位或密码不正确。' : '账号或密码不正确。',401);
    await request.session.regenerate();
    request.session.userId=identity.userId; request.session.csrf=randomBytes(32).toString('hex'); request.session.viewId=randomBytes(24).toString('hex'); request.session.expiresAt=Date.now()+config.sessionMs;
    request.accountIdentity=identity;
    request.identity=isBusinessIdentity(identity)?identity:undefined;
    request.workspaceIdentity=access.workspaceIdentity(identity.userId);
    return result(request);
  });
  app.post('/api/auth/logout', async request => {
    // Rotate once before notifying other tabs, so they share the same anonymous
    // session instead of racing to set different cookies and CSRF tokens.
    await request.session.regenerate();
    request.session.csrf=randomBytes(32).toString('hex');
    request.session.viewId=randomBytes(24).toString('hex');
    request.session.expiresAt=Date.now()+config.sessionMs;
    request.identity=undefined;
    request.accountIdentity=undefined;
    request.workspaceIdentity=undefined;
    return result(request);
  });
  const cleanup=setInterval(()=>db.prepare('DELETE FROM auth_sessions WHERE expires<=?').run(Date.now()),60000); cleanup.unref();
  app.addHook('onClose',async()=>clearInterval(cleanup));
}
export function accountIdentityOf(request: FastifyRequest): AccountIdentity { if(!request.accountIdentity) throw unauthorized(); return request.accountIdentity; }
/** Uses only the server-resolved current owner; it does not grant a business seat. */
export function workspaceIdentityOf(request: FastifyRequest): Identity {
  // Business routes already carry their authenticated seat actor. Only an
  // independent account needs the additional private-owner projection.
  const identity = request.identity ?? request.workspaceIdentity;
  if (!identity) throw unauthorized();
  return identity;
}
export function identityOf(request: FastifyRequest): Identity {
  if(!request.identity) {
    if(request.accountIdentity) throw new RequestError('FORBIDDEN','此操作需要业务席位。',403);
    throw unauthorized();
  }
  return request.identity;
}
