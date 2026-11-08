import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,createHmac,timingSafeEqual} from 'node:crypto';
import {fromNodeHeaders,toNodeHandler} from 'better-auth/node';
import {getRuntime,root} from './lib/runtime.mjs';
import {ConfigurationError} from './lib/config.mjs';
import {accountClass,classifyTransactions,demoData,applyChanges} from './finance.mjs';
import {createEngine,chatSystemPrompt,searchTool} from './insights.mjs';
import {describeForChat,loanPaymentIds,debtPlan,describeDebtForChat} from './loans.mjs';
import {parseStatement,mergeImport,importToPlaid,learnCategories,StatementError} from './statements.mjs';
const plaidEnvironments=['sandbox','production'];
const defaultEnv=process.env.PLAID_ENV || 'sandbox';
if(!plaidEnvironments.includes(defaultEnv))throw Error('PLAID_ENV must be sandbox or production');
const plaidBase=environment=>process.env.NODE_ENV==='test'&&process.env.PLAID_TEST_BASE_URL?process.env.PLAID_TEST_BASE_URL:`https://${environment}.plaid.com`;
class PlaidRequestError extends Error{constructor(data){super(String(data?.error_message||'Plaid rejected the request.'));this.code=String(data?.error_code||'PLAID_REQUEST_FAILED');this.requestId=data?.request_id||null;}}
function seal(token){const iv=crypto.getRandomValues(new Uint8Array(12)),c=createCipheriv('aes-256-gcm',getRuntime().key,iv);return Buffer.concat([iv,c.update(token),c.final(),c.getAuthTag()]).toString('base64');}
function unseal(token){const b=Buffer.from(token,'base64'),c=createDecipheriv('aes-256-gcm',getRuntime().key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString();}
function readEnvironment(value=defaultEnv){if(!plaidEnvironments.includes(value))throw Error('INVALID_PLAID_ENV');return value;}
async function plaidConfiguration(environment){
  const rows=await getRuntime().query('SELECT client_id,secret,updated_at,verified_at FROM plaid_config WHERE env=?',[environment]);
  if(rows[0])return {clientId:unseal(rows[0].client_id),secret:unseal(rows[0].secret),source:'dashboard',updatedAt:rows[0].updated_at,verifiedAt:rows[0].verified_at};
  if(environment===defaultEnv && process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET)return {clientId:process.env.PLAID_CLIENT_ID,secret:process.env.PLAID_SECRET,source:'vercel',updatedAt:null,verifiedAt:null};
  return null;
}
async function configurationSummary(){
  const result={};
  for(const environment of plaidEnvironments){const config=await plaidConfiguration(environment);result[environment]={configured:!!config,connected:!!config?.verifiedAt,source:config?.source||null,updatedAt:config?.updatedAt||null,verifiedAt:config?.verifiedAt||null};}
  return result;
}
async function validatePlaidCredentials(environment,clientId,secret){
  let response,data;
  try{
    response=await fetch(`${plaidBase(environment)}/institutions/get`,{method:'POST',headers:{'Content-Type':'application/json','Plaid-Version':'2020-09-14'},body:JSON.stringify({client_id:clientId,secret,count:1,offset:0,country_codes:['CA']}),signal:AbortSignal.timeout(15000)});
    data=await response.json();
  }catch{return {ok:false,code:'PLAID_UNREACHABLE',message:`Could not reach Plaid ${environment}. Check the network and try again.`};}
  if(!response.ok)return {ok:false,code:String(data?.error_code||'PLAID_CONNECTION_FAILED'),message:String(data?.error_message||'Plaid rejected these credentials.'),requestId:data?.request_id||null};
  return {ok:true,requestId:data?.request_id||null};
}
async function plaid(environment,path,body={}){
  const config=await plaidConfiguration(environment);if(!config)throw Error('PLAID_NOT_CONFIGURED');
  const r=await fetch(`${plaidBase(environment)}${path}`,{method:'POST',headers:{'Content-Type':'application/json','Plaid-Version':'2020-09-14'},body:JSON.stringify({client_id:config.clientId,secret:config.secret,...body}),signal:AbortSignal.timeout(45000)});
  const data=await r.json();if(!r.ok)throw new PlaidRequestError(data);return data;
}
const items=environment=>getRuntime().query('SELECT * FROM items WHERE env=?',[environment]);
async function sync(item){
  const access_token=unseal(item.token);
  // Commit all pages and the cursor together. A mutation restarts from the saved cursor.
  for(let attempt=0;attempt<3;attempt++){
    let cursor=item.cursor || undefined,pages=[];
    try{
      let more=true;
      while(more){const p=await plaid(item.env,'/transactions/sync',{access_token,cursor,count:500});pages.push(p);cursor=p.next_cursor;more=p.has_more;}
      const {accounts}=await plaid(item.env,'/accounts/get',{access_token});
      const tx=applyChanges(JSON.parse(item.transactions),pages);
      await getRuntime().query('UPDATE items SET cursor=?,accounts=?,transactions=?,synced=? WHERE id=? AND cursor IS NOT DISTINCT FROM ?',[cursor,JSON.stringify(accounts),JSON.stringify(tx),new Date().toISOString(),item.id,item.cursor]);
      return;
    }catch(e){if(e.message==='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt<2)continue;throw e;}
  }
}
// Accounts imported from PDF statements (for banks Plaid can't reach). One JSON record per account.
let importTable;
const ensureImportTable=()=>importTable||=getRuntime().query('CREATE TABLE IF NOT EXISTS imported_accounts (id TEXT PRIMARY KEY, env TEXT NOT NULL, record TEXT NOT NULL, updated_at TEXT NOT NULL)').catch(e=>{importTable=null;throw e;});
const importRows=async environment=>{await ensureImportTable();return getRuntime().query('SELECT id,record,updated_at FROM imported_accounts WHERE env=?',[environment]);};
const toAccount=(a,institution)=>({id:a.account_id,name:a.name,officialName:a.official_name||'',mask:a.mask,type:a.type,subtype:a.subtype||'',class:accountClass(a),institution,balance:a.balances.current,available:a.balances.available,limit:a.balances.limit,currency:a.balances.iso_currency_code||a.balances.unofficial_currency_code||'Unknown'});
async function liveData(environment){
  const rows=await items(environment),accounts=rows.flatMap(i=>JSON.parse(i.accounts).map(a=>toAccount(a,i.institution)));
  const raw=rows.map(i=>({i,accounts:JSON.parse(i.accounts),transactions:JSON.parse(i.transactions)}));
  const transactions=raw.flatMap(({i,accounts:itemAccounts,transactions:tx})=>classifyTransactions(tx,itemAccounts,i.institution));
  const connections=rows.map(i=>({id:i.id,institution:i.institution,synced:i.synced}));
  let imports=[];try{imports=await importRows(environment);}catch(e){console.error('Imported accounts unavailable',e.message);}
  if(imports.length){
    const learned=learnCategories(raw.flatMap(r=>r.transactions));
    for(const row of imports){const record=JSON.parse(row.record),{account,transactions:tx}=importToPlaid(record,learned),first=record.statements[0],last=record.statements.at(-1);
      accounts.push({...toAccount(account,record.institution),imported:true,asOf:record.account.asOf});
      transactions.push(...classifyTransactions(tx,[account],record.institution).map(t=>({...t,imported:true})));
      connections.push({id:`import:${record.key}`,institution:record.institution,synced:row.updated_at,imported:true,key:record.key,accountName:record.account.name,mask:record.account.mask,statements:record.statements.length,from:first?.start||null,to:last?.end||null,transactions:record.transactions.length});}
  }
  transactions.sort((a,b)=>b.date.localeCompare(a.date));
  return {demo:false,environment,accounts,transactions,coverage:{start:transactions.at(-1)?.date||null,end:transactions[0]?.date||null},connections};
}
const staticFiles={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/pages.js':['pages.js','text/javascript'],'/pages2.js':['pages2.js','text/javascript'],'/ui.js':['ui.js','text/javascript'],'/importer.js':['importer.js','text/javascript'],'/vendor/preact-htm.mjs':['vendor/preact-htm.mjs','text/javascript'],'/style.css':['style.css','text/css'],'/finance.mjs':['../finance.mjs','text/javascript'],'/insights.mjs':['../insights.mjs','text/javascript'],'/loans.mjs':['../loans.mjs','text/javascript'],'/plans.js':['plans.js','text/javascript'],'/login':['login.html','text/html'],'/login.js':['login.js','text/javascript'],'/auth.css':['auth.css','text/css']};
// Owner-created workspace data (loans, budgets, rules, layout, chat history). One JSON document per key.
const stateKeys=new Set(['prefs','data:demo','data:live','chat:demo','chat:live']);
let stateTable;
const ensureStateTable=()=>stateTable||=getRuntime().query('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)').catch(e=>{stateTable=null;throw e;});
async function readState(keys=[...stateKeys]){await ensureStateTable();const out={};for(const row of await getRuntime().query('SELECT key,value,updated_at FROM app_state'))if(keys.includes(row.key)){try{out[row.key]=JSON.parse(row.value);}catch{}}return out;}
// Saved chat conversations, one row per conversation (mode = demo or live).
let chatTable;
const ensureChatTable=()=>chatTable||=getRuntime().query('CREATE TABLE IF NOT EXISTS chat_conversations (id TEXT PRIMARY KEY, mode TEXT NOT NULL, title TEXT NOT NULL, messages TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)').catch(e=>{chatTable=null;throw e;});
async function dataFor(mode,environment){return mode==='live'?await liveData(environment):{...demoData(),environment};}
// Haiku by default: lowest cost per question. Set ANTHROPIC_MODEL to use a larger model.
const chatModel=()=>process.env.ANTHROPIC_MODEL||'claude-haiku-5-5';
let anthropicClient,useFallbacks=true;
async function askAssistant({mode,environment,messages}){
  if(!process.env.ANTHROPIC_API_KEY)return {status:503,body:{error:'AI_NOT_CONFIGURED',message:'Add ANTHROPIC_API_KEY to the Vercel environment variables and redeploy to enable Chat.'}};
  const {default:Anthropic}=await import('@anthropic-ai/sdk');
  anthropicClient||=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,timeout:50000,maxRetries:1});
  const state=await readState([`data:${mode}`]),ws=state[`data:${mode}`]||{};
  const raw=await dataFor(mode,environment),wsLoans=Array.isArray(ws.loans)?ws.loans:[];
  const J=createEngine(raw,{rules:ws.rules||{},overrides:ws.overrides||{},budgets:ws.budgets||{},tracked:ws.tracked||[],loanPayments:loanPaymentIds(wsLoans,raw?.transactions||[])});
  const wsGoals=Array.isArray(ws.goals)?ws.goals:[],plans=describeForChat(wsLoans,wsGoals,J.tx);
  plans.debt=describeDebtForChat(debtPlan({plan:J.plan({}),accounts:J.accounts,transactions:J.tx,loans:wsLoans,goals:wsGoals,cash:J.cash(),rates:ws.debt?.rates||{},today:J.todayIso}));
  const system=chatSystemPrompt(J,{budgets:ws.budgets||{},rules:ws.rules||{},plans,tracked:ws.tracked||[]});
  const convo=messages.map(m=>({role:m.role,content:m.content}));
  for(let step=0;step<5;step++){
    const request={model:chatModel(),max_tokens:4000,output_config:{effort:'low'},system,tools:[searchTool],messages:convo};
    let response;
    // The backup-model option is only accepted for Opus and Sonnet models.
    if(useFallbacks&&/^claude-(opus|sonnet)/.test(request.model)){try{response=await anthropicClient.beta.messages.create({...request,betas:['server-side-fallback-2026-07-01'],fallbacks:'default'});}catch(e){if(e?.status!==400||!/fallback|beta|server-side/i.test(String(e?.message||'')))throw e;console.error('Chat: refusal fallbacks rejected, retrying without them:',String(e.message).slice(0,200));useFallbacks=false;}}
    if(!response)response=await anthropicClient.messages.create(request);
    if(response.stop_reason==='refusal')return {status:200,body:{text:'{"answer":"I can’t help with that one. Try asking about your spending, bills, savings or a what-if.","followups":[]}'}};
    if(response.stop_reason==='pause_turn'){convo.push({role:'assistant',content:response.content});continue;}
    const toolCalls=response.content.filter(b=>b.type==='tool_use');
    if(response.stop_reason!=='tool_use'||!toolCalls.length)return {status:200,body:{text:response.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')}};
    convo.push({role:'assistant',content:response.content});
    convo.push({role:'user',content:toolCalls.map(call=>{try{return {type:'tool_result',tool_use_id:call.id,content:JSON.stringify(J.search(call.input||{}))};}catch(e){return {type:'tool_result',tool_use_id:call.id,content:'Search failed.',is_error:true};}})});
  }
  return {status:200,body:{text:'{"answer":"That took more lookups than expected. Try a narrower question.","followups":[]}'}};
}
const authPaths=new Set(['/api/auth/sign-in/email','/api/auth/sign-out','/api/auth/get-session','/api/auth/change-password','/api/auth/ok']);
export default async function handler(req,res){
  const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});res.end(type==='application/json'?JSON.stringify(data):data);};
  try{
    const runtime=getRuntime(),{origin,auth,owner}=runtime;
    if(req.headers.host!==new URL(origin).host){
      // A preview's one-off commit address forwards to the stable branch address the app runs on.
      if(process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_URL&&req.headers.host===process.env.VERCEL_URL&&req.method==='GET'){res.writeHead(302,{Location:new URL(req.url,origin).href,'Cache-Control':'no-store'});return res.end();}
      return send(403,{error:'Invalid host'});
    }
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
      const environment=readEnvironment(url.searchParams.get('env')||defaultEnv);
      if(url.pathname==='/api/status'){const config=await plaidConfiguration(environment);return send(200,{configured:!!config,connected:!!config?.verifiedAt,environment,csrf,connections:(await items(environment)).length+(await importRows(environment).catch(()=>[])).length,email:session.user.email,ai:!!process.env.ANTHROPIC_API_KEY});}
      if(url.pathname==='/api/state')return send(200,{state:await readState()});
      if(url.pathname==='/api/chats'){
        await ensureChatTable();const mode=url.searchParams.get('mode')==='live'?'live':'demo',id=url.searchParams.get('id');
        if(id){const [row]=await getRuntime().query('SELECT id,title,messages,created_at,updated_at FROM chat_conversations WHERE id=? AND mode=?',[id,mode]);if(!row)return send(404,{error:'Conversation not found'});return send(200,{conversation:{id:row.id,title:row.title,messages:JSON.parse(row.messages),createdAt:row.created_at,updatedAt:row.updated_at}});}
        const rows=await getRuntime().query('SELECT id,title,messages,created_at,updated_at FROM chat_conversations WHERE mode=? ORDER BY updated_at DESC LIMIT 200',[mode]);
        return send(200,{conversations:rows.map(r=>({id:r.id,title:r.title,count:JSON.parse(r.messages).filter(m=>m.role==='user').length,createdAt:r.created_at,updatedAt:r.updated_at}))});
      }
      if(url.pathname==='/api/plaid-config')return send(200,{environments:await configurationSummary()});
      if(url.pathname==='/api/data')return send(200,url.searchParams.get('mode')==='live'?await liveData(environment):{...demoData(),environment});
      const file=staticFiles[url.pathname];if(file){if(url.pathname==='/vendor/preact-htm.mjs')res.setHeader('Cache-Control','private, max-age=86400');return send(200,readFileSync(join(root,'web',file[0])),file[1]);}
      return send(404,{error:'Not found'});
    }
    const supplied=req.headers['x-csrf-token'];
    if(!csrf || typeof supplied!=='string' || supplied.length!==csrf.length || !timingSafeEqual(Buffer.from(supplied),Buffer.from(csrf)))return send(403,{error:'Reload the dashboard to authorize this request'});
    const maxBody=url.pathname==='/api/import/statement'?4400000:url.pathname==='/api/chats/save'?1048576:url.pathname==='/api/state'?524288:url.pathname==='/api/chat'?65536:16384;
    let raw='';
    if(req.body!==undefined)raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    else for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>maxBody)return send(413,{error:'Request too large'});}
    if(Buffer.byteLength(raw)>maxBody)return send(413,{error:'Request too large'});
    const body=JSON.parse(raw||'{}');
    const environment=readEnvironment(body.environment||defaultEnv);
    if(url.pathname==='/api/state'){
      if(!stateKeys.has(body.key)||body.value===null||typeof body.value!=='object')return send(400,{error:'Invalid workspace data'});
      await ensureStateTable();const updatedAt=new Date().toISOString();
      await getRuntime().query('INSERT INTO app_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',[body.key,JSON.stringify(body.value),updatedAt]);
      return send(200,{ok:true,updatedAt});
    }
    if(url.pathname==='/api/import/statement'){
      if(typeof body.data!=='string'||!body.data)return send(400,{error:'Attach a PDF statement.'});
      const pdf=Buffer.from(body.data,'base64');
      if(pdf.length<100||pdf.subarray(0,5).toString()!=='%PDF-')return send(400,{error:'NOT_A_PDF',message:'That file isn’t a PDF.'});
      let parsed;try{parsed=await parseStatement(pdf);}catch(e){return send(422,{error:e instanceof StatementError?e.code:'STATEMENT_UNREADABLE',message:e instanceof StatementError?e.message:'This PDF could not be read.'});}
      if(!parsed.transactions.length&&parsed.previous===parsed.total)return send(200,{ok:true,skipped:true,period:parsed.period,message:'No transactions in this statement.'});
      if(!parsed.reconciled)return send(422,{error:'STATEMENT_DOES_NOT_BALANCE',message:`The transactions read from this statement are off by ${parsed.difference.toFixed(2)} compared with its totals, so it wasn’t saved.`,period:parsed.period});
      await ensureImportTable();
      const id=`${environment}:${parsed.account.key}`,[row]=await getRuntime().query('SELECT record FROM imported_accounts WHERE id=?',[id]),before=row?JSON.parse(row.record):null;
      let record;try{record=mergeImport(before,parsed);}catch(e){if(e instanceof StatementError)return send(422,{error:e.code,message:e.message,period:parsed.period});throw e;}
      const added=record.transactions.length-(before?.transactions.length||0),updatedAt=new Date().toISOString();
      await getRuntime().query('INSERT INTO imported_accounts(id,env,record,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,updated_at=excluded.updated_at',[id,environment,JSON.stringify(record),updatedAt]);
      return send(200,{ok:true,account:{name:record.account.name,mask:record.account.mask},period:parsed.period,transactions:parsed.transactions.length,added,total:record.transactions.length});
    }
    if(url.pathname==='/api/import/remove'){
      if(typeof body.key!=='string')return send(400,{error:'Missing account'});
      await ensureImportTable();await getRuntime().query('DELETE FROM imported_accounts WHERE id=?',[`${environment}:${body.key}`]);return send(200,{ok:true});
    }
    if(url.pathname==='/api/chats/save'){
      const mode=body.mode==='live'?'live':'demo',id=typeof body.id==='string'?body.id:'',messages=Array.isArray(body.messages)?body.messages.slice(-200):null;
      if(!/^c[a-z0-9]{6,40}$/i.test(id)||!messages)return send(400,{error:'Invalid conversation'});
      const title=String(body.title||messages.find(m=>m?.role==='user')?.text||'Conversation').replace(/\s+/g,' ').trim().slice(0,120)||'Conversation',now=new Date().toISOString();
      await ensureChatTable();
      await getRuntime().query('INSERT INTO chat_conversations(id,mode,title,messages,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,messages=excluded.messages,updated_at=excluded.updated_at',[id,mode,title,JSON.stringify(messages),now,now]);
      return send(200,{ok:true,updatedAt:now});
    }
    if(url.pathname==='/api/chats/delete'){
      if(typeof body.id!=='string')return send(400,{error:'Missing conversation'});
      await ensureChatTable();await getRuntime().query('DELETE FROM chat_conversations WHERE id=?',[body.id]);return send(200,{ok:true});
    }
    if(url.pathname==='/api/chat'){
      const mode=body.mode==='live'?'live':'demo',messages=Array.isArray(body.messages)?body.messages.slice(-12):[];
      if(!messages.length||messages.some(m=>!['user','assistant'].includes(m?.role)||typeof m.content!=='string'||!m.content.trim()||m.content.length>6000)||messages[0].role!=='user'||messages.at(-1).role!=='user')return send(400,{error:'Invalid chat request'});
      try{const result=await askAssistant({mode,environment,messages});return send(result.status,result.body);}
      catch(e){console.error('Chat request failed:',e?.status||'',e?.name||'',String(e?.message||'').slice(0,300));const detail=String(e?.message||'');return send(502,{error:'AI_REQUEST_FAILED',message:/credit balance/i.test(detail)?'Your Anthropic API account is out of credits. Add credits at console.anthropic.com → Settings → Billing, then try again.':e?.status===429?'The assistant is busy right now. Try again in a minute.':e?.status===401?'The ANTHROPIC_API_KEY was rejected. Check it in Vercel.':'The assistant could not answer right now. Try again shortly.'});}
    }
    if(url.pathname==='/api/plaid-config'){
      const clientId=typeof body.clientId==='string'?body.clientId.trim():'';
      const secret=typeof body.secret==='string'?body.secret.trim():'';
      if(clientId.length<8 || clientId.length>512 || secret.length<8 || secret.length>512)return send(400,{error:'Enter a valid Plaid client ID and matching environment secret.'});
      const validation=await validatePlaidCredentials(environment,clientId,secret);
      if(!validation.ok)return send(400,{error:'PLAID_CONNECTION_FAILED',message:validation.message,plaid:{code:validation.code,requestId:validation.requestId||null}});
      const updatedAt=new Date().toISOString();
      await getRuntime().query('INSERT INTO plaid_config(env,client_id,secret,updated_at,verified_at) VALUES(?,?,?,?,?) ON CONFLICT(env) DO UPDATE SET client_id=excluded.client_id,secret=excluded.secret,updated_at=excluded.updated_at,verified_at=excluded.verified_at',[environment,seal(clientId),seal(secret),updatedAt,updatedAt]);
      return send(200,{ok:true,environment,configured:true,connected:true,source:'dashboard',updatedAt,verifiedAt:updatedAt});
    }
    if(url.pathname==='/api/plaid-config/verify'){
      const config=await plaidConfiguration(environment);if(!config)return send(404,{error:'No saved Plaid configuration exists for this environment.'});
      const validation=await validatePlaidCredentials(environment,config.clientId,config.secret);
      if(!validation.ok)return send(400,{error:'PLAID_CONNECTION_FAILED',message:validation.message,plaid:{code:validation.code,requestId:validation.requestId||null}});
      const verifiedAt=new Date().toISOString();
      if(config.source==='dashboard')await getRuntime().query('UPDATE plaid_config SET verified_at=? WHERE env=?',[verifiedAt,environment]);
      return send(200,{ok:true,environment,connected:true,verifiedAt});
    }
    if(url.pathname==='/api/link-token'){
      const payload={user:{client_user_id:'local-personal-user'},client_name:'Jainam Finance',language:'en',country_codes:['CA']};
      if(body.itemId){const i=(await items(environment)).find(x=>x.id===body.itemId);if(!i)return send(404,{error:'Connection not found'});payload.access_token=unseal(i.token);}
      else {payload.products=['transactions'];payload.transactions={days_requested:730};}
      if(environment==='production'){
        payload.link_customization_name=process.env.PLAID_LINK_CUSTOMIZATION || 'jainam_finances_prod';
        payload.redirect_uri=process.env.PLAID_REDIRECT_URI || `${origin}/`;
      }
      const r=await plaid(environment,'/link/token/create',payload);return send(200,{link_token:r.link_token});
    }
    if(url.pathname==='/api/exchange'){
      if(typeof body.public_token!=='string')return send(400,{error:'Missing public token'});
      const r=await plaid(environment,'/item/public_token/exchange',{public_token:body.public_token});
      await getRuntime().query('INSERT INTO items(id,env,token,institution) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',[r.item_id,environment,seal(r.access_token),String(body.institution || 'Connected bank').slice(0,100)]);
      try{await sync((await items(environment)).find(i=>i.id===r.item_id));return send(200,{ok:true});}catch(e){return send(200,{ok:true,warning:`Account linked; sync needs attention: ${e.message}`});}
    }
    if(url.pathname==='/api/sync'){
      const results=[];for(const i of await items(environment)){try{await sync(i);results.push({institution:i.institution,ok:true});}catch(e){results.push({institution:i.institution,ok:false,error:e.message});}}return send(200,{results});
    }
    return send(404,{error:'Not found'});
  }catch(e){
    if(e instanceof ConfigurationError){
      if(req.url.startsWith('/api/'))return send(503,{error:'SETUP_REQUIRED',message:'The owner must configure the required Vercel environment variables and redeploy. Financial data access is disabled.'});
      return send(503,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Setup required · Jainam Finance</title><body style="font:16px system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#183c35;background:#f7f8f5"><h1>One more setup step.</h1><p>Your private dashboard is deployed, but its server configuration is incomplete. Financial data access is disabled.</p><p>In Vercel, open <strong>Project Settings → Environment Variables</strong>, add the required variables from the repository README, then redeploy.</p><p>Required: APP_URL, OWNER_EMAIL, BETTER_AUTH_SECRET, DATABASE_URL, DATA_ENCRYPTION_KEY. For the first owner setup, also set INITIAL_PASSWORD.</p><p>Do not enter passwords or API keys on this page.</p></body></html>','text/html');
    }
    if(e instanceof PlaidRequestError)return send(400,{error:e.code,message:e.message,plaid:{code:e.code,requestId:e.requestId}});
    const known=/^[A-Z][A-Z_]+$/.test(e.message);send(400,{error:known?e.message:'Request failed. Check your configuration or try again.'});}
}
