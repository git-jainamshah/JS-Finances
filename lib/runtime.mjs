import {mkdirSync,chmodSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import pg from 'pg';
import {betterAuth} from 'better-auth';
import {createAuthMiddleware} from 'better-auth/api';
import {configurationIssues,ConfigurationError} from './config.mjs';
export const root=dirname(dirname(fileURLToPath(import.meta.url)));
let runtime;
export function getRuntime(){
 if(runtime)return runtime;
 const issues=configurationIssues();if(issues.length)throw new ConfigurationError(issues);
 const hosted=!!process.env.VERCEL || process.env.NODE_ENV==='production';
 const origin=process.env.APP_URL || (hosted?'':`http://localhost:${process.env.PORT || 4317}`);
 if(!origin)throw Error('APP_URL is required');
 const parsed=new URL(origin);
 if(parsed.origin!==origin || (hosted&&parsed.protocol!=='https:'))throw Error('APP_URL must be an exact origin; HTTPS is required in production');
 if(hosted&&!process.env.DATABASE_URL)throw Error('DATABASE_URL is required in production');
 const owner=(process.env.OWNER_EMAIL || '').trim().toLowerCase();
 if(!owner)throw Error('OWNER_EMAIL is required');
 let secret=process.env.BETTER_AUTH_SECRET;
 if(!secret || secret.length<32)throw Error('BETTER_AUTH_SECRET must be at least 32 characters');
 let database,query,close;
 if(process.env.DATABASE_URL){
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
  database=pool;query=async(sql,params=[])=>{let i=0;const converted=sql.replace(/\?/g,()=>`$${++i}`);return (await pool.query(converted,params)).rows;};close=()=>pool.end();
 }else{
  const dir=process.env.FINANCE_DATA_DIR || join(root,'.data');mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
  const path=join(dir,'finance.sqlite');database=new DatabaseSync(path);chmodSync(path,0o600);database.exec('PRAGMA busy_timeout=5000');
  query=async(sql,params=[])=>database.prepare(sql).all(...params);close=async()=>database.close();
 }
 let key;
 if(process.env.DATA_ENCRYPTION_KEY){key=Buffer.from(process.env.DATA_ENCRYPTION_KEY,'base64');if(key.length!==32)throw Error('DATA_ENCRYPTION_KEY must encode 32 bytes');}
 else if(hosted)throw Error('DATA_ENCRYPTION_KEY is required in production');
 else {const path=join(process.env.FINANCE_DATA_DIR||join(root,'.data'),'key');if(!existsSync(path))writeFileSync(path,randomBytes(32),{mode:0o600});key=readFileSync(path);}
 const options={database,baseURL:origin,secret,trustedOrigins:[origin],emailAndPassword:{enabled:true,disableSignUp:true,minPasswordLength:12,maxPasswordLength:128},session:{expiresIn:60*60*12,updateAge:60*60,cookieCache:{enabled:false}},rateLimit:{enabled:true,storage:'database',window:60,max:60,customRules:{'/sign-in/email':{window:60,max:5},'/change-password':{window:60,max:5}}},advanced:{useSecureCookies:parsed.protocol==='https:',defaultCookieAttributes:{httpOnly:true,sameSite:'lax'},ipAddress:{ipAddressHeaders:hosted?['x-vercel-forwarded-for']:[]}},telemetry:{enabled:false}};
 options.hooks={before:createAuthMiddleware(async ctx=>{if(ctx.path==='/change-password')return {context:{...ctx,body:{...ctx.body,revokeOtherSessions:true}}};})};
 let auth;
 runtime={database,query,close,get auth(){return auth ||= betterAuth(options);},options,origin,owner,key,secret,hosted};return runtime;
}
