import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,createHmac,timingSafeEqual} from 'node:crypto';
import {fromNodeHeaders,toNodeHandler} from 'better-auth/node';
import {getRuntime,root} from './lib/runtime.mjs';
import {normalize,demoData,applyChanges} from './finance.mjs';
const env=process.env.PLAID_ENV || 'sandbox';
if(!['sandbox','production'].includes(env))throw Error('PLAID_ENV must be sandbox or production');
const configured=!!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
function seal(token){const iv=crypto.getRandomValues(new Uint8Array(12)),c=createCipheriv('aes-256-gcm',getRuntime().key,iv);return Buffer.concat([iv,c.update(token),c.final(),c.getAuthTag()]).toString('base64');}
function unseal(token){const b=Buffer.from(token,'base64'),c=createDecipheriv('aes-256-gcm',getRuntime().key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString();}
async function plaid(path,body={}){
  if(!configured)throw Error('PLAID_NOT_CONFIGURED');
  const r=await fetch(`https://${env}.plaid.com${path}`,{method:'POST',headers:{'Content-Type':'application/json','Plaid-Version':'2020-09-14'},body:JSON.stringify({client_id:process.env.PLAID_CLIENT_ID,secret:process.env.PLAID_SECRET,...body}),signal:AbortSignal.timeout(45000)});
  const data=await r.json();if(!r.ok)throw Error(data.error_code || 'PLAID_REQUEST_FAILED');return data;
}
const items=()=>getRuntime().query('SELECT * FROM items WHERE env=?',[env]);
async function sync(item){
  const access_token=unseal(item.token);
  // Commit all pages and the cursor together. A mutation restarts from the saved cursor.
  for(let attempt=0;attempt<3;attempt++){
    let cursor=item.cursor || undefined,pages=[];
    try{
      let more=true;
      while(more){const p=await plaid('/transactions/sync',{access_token,cursor,count:500});pages.push(p);cursor=p.next_cursor;more=p.has_more;}
      const {accounts}=await plaid('/accounts/get',{access_token});
      const tx=applyChanges(JSON.parse(item.transactions),pages);
      await getRuntime().query('UPDATE items SET cursor=?,accounts=?,transactions=?,synced=? WHERE id=? AND cursor IS NOT DISTINCT FROM ?',[cursor,JSON.stringify(accounts),JSON.stringify(tx),new Date().toISOString(),item.id,item.cursor]);
      return;
    }catch(e){if(e.message==='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt<2)continue;throw e;}
  }
}
async function liveData(){
  const rows=await items();return {demo:false,accounts:rows.flatMap(i=>JSON.parse(i.accounts).map(a=>({id:a.account_id,name:a.name,mask:a.mask,type:a.type,institution:i.institution,balance:a.balances.current,currency:a.balances.iso_currency_code || 'Unknown'}))),transactions:rows.flatMap(i=>JSON.parse(i.transactions).map(t=>normalize(t,i.institution))).sort((a,b)=>b.date.localeCompare(a.date)),connections:rows.map(i=>({id:i.id,institution:i.institution,synced:i.synced}))};
}
const staticFiles={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/finance.mjs':['../finance.mjs','text/javascript'],'/login':['login.html','text/html'],'/login.js':['login.js','text/javascript'],'/auth.css':['auth.css','text/css']};
const authPaths=new Set(['/api/auth/sign-in/email','/api/auth/sign-out','/api/auth/get-session','/api/auth/change-password','/api/auth/ok']);
export default async function handler(req,res){
  const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});res.end(type==='application/json'?JSON.stringify(data):data);};
  try{
    const runtime=getRuntime(),{origin,auth,owner}=runtime;
    if(req.headers.host!==new URL(origin).host)return send(403,{error:'Invalid host'});
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    if(runtime.hosted)res.setHeader('Strict-Transport-Security','max-age=31536000');
    const url=new URL(req.url,origin);
    if(!['GET','POST'].includes(req.method))return send(405,{error:'Method not allowed'});
    if(req.method==='POST' && (req.headers.origin!==origin || !req.headers['content-type']?.startsWith('application/json')))return send(403,{error:'Invalid request origin or content type'});
    // Never expose signup, reset, email-change, or account-management endpoints.
    if(url.pathname.startsWith('/api/auth/')){
      if(!authPaths.has(url.pathname))return send(404,{error:'Not found'});
      if(url.pathname==='/api/auth/change-password'){
        const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
        if(!session || session.user.email.toLowerCase()!==owner)return send(401,{error:'Sign in required'});
      }
      return await toNodeHandler(auth)(req,res);
    }
    const publicPage=['/login','/login.js','/auth.css'].includes(url.pathname);
    let session;
    if(!publicPage){
      session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});
      if(!session || session.user.email.toLowerCase()!==owner){
        if(!url.pathname.startsWith('/api/')){res.writeHead(302,{Location:'/login','Cache-Control':'no-store'});return res.end();}
        return send(401,{error:'Sign in required'});
      }
    }
    const csrf=session?createHmac('sha256',runtime.secret).update(session.session.token).digest('hex'):null;
    if(req.method==='GET'){
      if(url.pathname==='/api/status')return send(200,{configured,environment:env,csrf,connections:(await items()).length,email:session.user.email});
      if(url.pathname==='/api/data')return send(200,url.searchParams.get('mode')==='live'?await liveData():demoData());
      const file=staticFiles[url.pathname];if(file)return send(200,readFileSync(join(root,'web',file[0])),file[1]);
      return send(404,{error:'Not found'});
    }
    const supplied=req.headers['x-csrf-token'];
    if(!csrf || typeof supplied!=='string' || supplied.length!==csrf.length || !timingSafeEqual(Buffer.from(supplied),Buffer.from(csrf)))return send(403,{error:'Reload the dashboard to authorize this request'});
    let raw='';
    if(req.body!==undefined)raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    else for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)return send(413,{error:'Request too large'});}
    if(Buffer.byteLength(raw)>16384)return send(413,{error:'Request too large'});
    const body=JSON.parse(raw||'{}');
    if(url.pathname==='/api/link-token'){
      const payload={user:{client_user_id:'local-personal-user'},client_name:'Jainam Finance',language:'en',country_codes:['CA']};
      if(body.itemId){const i=(await items()).find(x=>x.id===body.itemId);if(!i)return send(404,{error:'Connection not found'});payload.access_token=unseal(i.token);}
      else {payload.products=['transactions'];payload.transactions={days_requested:730};}
      if(process.env.PLAID_REDIRECT_URI)payload.redirect_uri=process.env.PLAID_REDIRECT_URI;
      const r=await plaid('/link/token/create',payload);return send(200,{link_token:r.link_token});
    }
    if(url.pathname==='/api/exchange'){
      if(typeof body.public_token!=='string')return send(400,{error:'Missing public token'});
      const r=await plaid('/item/public_token/exchange',{public_token:body.public_token});
      await getRuntime().query('INSERT INTO items(id,env,token,institution) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',[r.item_id,env,seal(r.access_token),String(body.institution || 'Connected bank').slice(0,100)]);
      try{await sync((await items()).find(i=>i.id===r.item_id));return send(200,{ok:true});}catch(e){return send(200,{ok:true,warning:`Account linked; sync needs attention: ${e.message}`});}
    }
    if(url.pathname==='/api/sync'){
      const results=[];for(const i of await items()){try{await sync(i);results.push({institution:i.institution,ok:true});}catch(e){results.push({institution:i.institution,ok:false,error:e.message});}}return send(200,{results});
    }
    return send(404,{error:'Not found'});
  }catch(e){const known=/^[A-Z][A-Z_]+$/.test(e.message);send(400,{error:known?e.message:'Request failed. Check your configuration or try again.'});}
}
