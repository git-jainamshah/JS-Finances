import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

test('authentication gate, password change, persistent owner, CSRF, and rate limiting',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'finance-auth-'));
 const port=14317,base=`http://localhost:${port}`,email='owner@example.test',password=randomBytes(20).toString('hex'),newPassword=randomBytes(20).toString('hex');
 const env={...process.env,PORT:String(port),APP_URL:base,OWNER_EMAIL:email,BETTER_AUTH_SECRET:randomBytes(40).toString('hex'),INITIAL_PASSWORD:password,FINANCE_DATA_DIR:dir,NODE_ENV:'test',DATABASE_URL:'',VERCEL:'',DATA_ENCRYPTION_KEY:''};
 let server;
 try{
  const setup=spawnSync(process.execPath,['scripts/setup.mjs'],{env,encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
  server=spawn(process.execPath,['server.mjs'],{env,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),15000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}`));});});
  const get=(path,cookie='')=>fetch(base+path,{redirect:'manual',headers:{cookie}});
  const post=(path,body,cookie='',origin=base,extra={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',origin,cookie,...extra},body:JSON.stringify(body)});
  const cookies=r=>r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  for(const path of ['/','/app.js','/finance.mjs','/index.html','/web/index.html','/.env','/.data/key'])assert.equal((await get(path)).status,302,path);
  for(const path of ['/api/data?mode=live','/api/data?mode=demo','/api/status'])assert.equal((await get(path)).status,401,path);
  assert.equal((await get('/login')).status,200);
  assert.equal((await post('/api/auth/sign-up/email',{email:'other@example.test',password,name:'Other'})).status,404);
  assert.equal((await post('/api/auth/sign-in/email',{email,password},'','https://evil.example')).status,403);
  assert.equal((await post('/api/auth/change-password',{currentPassword:password,newPassword})).status,401);
  assert.equal((await post('/api/auth/sign-in/email',{email,password:'not-the-password'})).status,401);
  const signIn=await post('/api/auth/sign-in/email',{email,password});assert.equal(signIn.status,200);assert.match(signIn.headers.getSetCookie().join(';'),/HttpOnly/i);assert.match(signIn.headers.getSetCookie().join(';'),/SameSite=Lax/i);let cookie=cookies(signIn);
  const second=await post('/api/auth/sign-in/email',{email,password});assert.equal(second.status,200);const otherCookie=cookies(second);
  assert.equal((await get('/',cookie)).status,200);assert.equal((await get('/api/data?mode=live',cookie)).status,200);
  for(const path of ['/.env','/.data/key','/server.mjs','/web/index.html'])assert.equal((await get(path,cookie)).status,404,path);
  const status=await (await get('/api/status',cookie)).json();assert.ok(status.csrf);assert.equal(status.email,email);
  assert.equal((await post('/api/sync',{},cookie)).status,403);
  assert.equal((await post('/api/sync',{},cookie,base,{'X-CSRF-Token':status.csrf})).status,200);
  const badChange=await post('/api/auth/change-password',{currentPassword:'wrong-current',newPassword},cookie);assert.notEqual(badChange.status,200);
  const changed=await post('/api/auth/change-password',{currentPassword:password,newPassword,revokeOtherSessions:false},cookie);assert.equal(changed.status,200,await changed.clone().text());cookie=cookies(changed)||cookie;
  assert.equal((await get('/api/data',otherCookie)).status,401,'Other session must be revoked even if caller requests otherwise');
  assert.equal((await get('/api/status',cookie)).status,200);
  const again=spawnSync(process.execPath,['scripts/setup.mjs'],{env,encoding:'utf8'});assert.equal(again.status,0,again.stderr);
  assert.equal((await post('/api/auth/sign-in/email',{email,password})).status,401,'Old seed password must not come back after setup');
  const newLogin=await post('/api/auth/sign-in/email',{email,password:newPassword});assert.equal(newLogin.status,200);cookie=cookies(newLogin);
  assert.equal((await post('/api/auth/sign-out',{},cookie)).status,200);assert.equal((await get('/api/data',cookie)).status,401);
  const limited=await post('/api/auth/sign-in/email',{email,password:'wrong'});assert.equal(limited.status,429,'Sign-in is rate limited');
 }finally{if(server && server.exitCode===null){await new Promise(resolve=>{server.once('exit',resolve);server.kill();});}rmSync(dir,{recursive:true,force:true});}
});
