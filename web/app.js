import {html,render,Component} from '/vendor/preact-htm.mjs';
import {createEngine,money,iso,mk,mLong} from '/insights.mjs';
import {NavIcon,BrandMark,Wordmark,Select,DEFAULT_LAYOUT} from '/ui.js';
import {Pages} from '/pages.js';

const SAMPLE_LOANS=[{id:'honda',dir:'owe',name:'Honda Civic auto loan',who:'Honda Financial Services',original:24000,balance:14620,payment:486,rate:4.99,day:15,connected:true,institution:'RBC'},{id:'osap',dir:'owe',name:'OSAP student loan',who:'National Student Loans Service Centre',original:18500,balance:6840,payment:260,rate:6.2,day:28,connected:false},{id:'fam',dir:'owe',name:'Help with first & last rent',who:'Mom & Dad',original:5000,balance:3200,payment:200,rate:0,day:1,connected:false},{id:'arjun',dir:'owed',name:'Concert tickets + Montreal trip',who:'Arjun',original:1500,balance:900,payment:150,rate:0,day:30,connected:false}];
export const PAGES=[['overview','Overview','Home'],['spending','Spending','Spending'],['recurring','Recurring','Bills'],['loans','Loans & IOUs','Loans'],['projections','Projections','Plan'],['transactions','Transactions','Activity'],['chat','Chat','Chat'],['settings','Settings','Settings']];
const PREF_KEYS=['layout','saved','views','density','reduceMotion'],DATA_KEYS=['budgets','rules','overrides','loans','dismissed','tracked'];
const LOCAL='jsf-ui-v2',ENV_KEY='finance-plaid-environment';
const readLocal=()=>{try{return JSON.parse(localStorage.getItem(LOCAL)||'{}');}catch{return {};}};
const blankData=mode=>({budgets:{},rules:{},overrides:{},loans:mode==='demo'?SAMPLE_LOANS:[],dismissed:[],tracked:[]});

class App extends Component{
 constructor(){
  super();const L=readLocal(),env=localStorage.getItem(ENV_KEY);
  this.state={booting:true,bootError:'',status:null,data:null,plaid:null,mode:'demo',env:['sandbox','production'].includes(env)?env:'sandbox',busy:'',
   page:L.page||'overview',range:L.range||'12m',custom:L.custom||null,inst:'',edit:false,moreOpen:false,cpMonth:'',
   layout:DEFAULT_LAYOUT,saved:[],views:[],density:'comfortable',reduceMotion:false,...blankData('demo'),msgs:[],
   loanFilter:'all',loanForm:null,loanErr:'',extra:{},payFor:'',payAmt:'',input:'',loading:false,quick:'',nwHover:null,budgetMonth:'last',
   cat:'',merchant:'',calMonth:'',calDay:'',incChg:0,oneOff:0,oneOffMonth:6,cuts:{},cancel:[],goal:10000,cfHover:null,showCustom:false,cStart:'',cEnd:'',
   q:'',tCat:'',tType:'all',sort:{key:'date',dir:'desc'},limit:40,editTx:'',editCat:'',editRule:true,view:'all',
   setTab:'connections',w:window.innerWidth,toast:'',draft:null,leaveTo:null,savedAt:'',plaidEditing:false,plaidMsg:null,pwMsg:'',pwBusy:false};
  this.store={};this.lastSaved={};this.timers={};
 }
 // ---------- server ----------
 async api(path,body){
  const payload=body&&!path.startsWith('/api/auth/')?{environment:this.state.env,...body}:body;
  const r=await fetch(path,payload?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':this.state.status?.csrf||''},body:JSON.stringify(payload)}:{});
  if(r.status===401){location.replace('/login');throw Error('Your session expired. Please sign in again.');}
  const d=await r.json().catch(()=>({}));
  if(!r.ok){const detail=d.plaid?.code?` (${d.plaid.code}${d.plaid.requestId?` · request ${d.plaid.requestId}`:''})`:'';const err=Error((d.message||d.error||'Request failed')+detail);err.code=d.error;throw err;}
  return d;
 }
 envPath(path){return `${path}${path.includes('?')?'&':'?'}env=${this.state.env}`;}
 async componentDidMount(){
  this.onResize=()=>this.setState({w:window.innerWidth});window.addEventListener('resize',this.onResize);
  this.onUnload=()=>this.flushSaves();window.addEventListener('pagehide',this.onUnload);
  try{
   const oauth=new URLSearchParams(location.search).has('oauth_state_id');
   if(oauth){const e=sessionStorage.getItem('plaid-environment');if(e)this.setState({env:e});}
   await new Promise(r=>this.setState({},r));
   const status=await this.api(this.envPath('/api/status'));
   const [stateRes,plaid]=await Promise.all([this.api('/api/state').catch(()=>({state:{},failed:true})),this.api('/api/plaid-config').catch(()=>null)]);
   this.store=stateRes.state||{};this.stateFailed=!!stateRes.failed;
   const mode=status.connections?'live':'demo';
   this.setState({status,plaid,mode,...this.groupFrom('prefs'),...this.groupFrom(`data:${mode}`,mode),msgs:this.store[`chat:${mode}`]?.msgs||[]});
   for(const k of ['prefs',`data:${mode}`,`chat:${mode}`])this.lastSaved[k]=JSON.stringify(this.groupValue(k,mode));
   await this.loadData(mode);
   if(oauth)await this.connect(undefined,true);
  }catch(e){this.setState({booting:false,bootError:e.message});}
 }
 componentWillUnmount(){window.removeEventListener('resize',this.onResize);window.removeEventListener('pagehide',this.onUnload);}
 groupFrom(key,mode){const v=this.store[key]||{};if(key==='prefs')return {layout:Array.isArray(v.layout)?v.layout:DEFAULT_LAYOUT,saved:v.saved||[],views:v.views||[],density:v.density||'comfortable',reduceMotion:!!v.reduceMotion};const b=blankData(mode);return Object.fromEntries(DATA_KEYS.map(k=>[k,v[k]??b[k]]));}
 groupValue(key,mode=this.state.mode,S=this.state){if(key==='prefs')return Object.fromEntries(PREF_KEYS.map(k=>[k,S[k]]));if(key.startsWith('data:'))return Object.fromEntries(DATA_KEYS.map(k=>[k,S[k]]));return {msgs:S.msgs.slice(-30)};}
 componentDidUpdate(){
  const S=this.state;if(S.booting)return;
  try{localStorage.setItem(LOCAL,JSON.stringify({page:S.page,range:S.range,custom:S.custom}));}catch{}
  for(const key of ['prefs',`data:${S.mode}`,`chat:${S.mode}`]){const v=JSON.stringify(this.groupValue(key));if(v!==this.lastSaved[key]){this.lastSaved[key]=v;this.store[key]=JSON.parse(v);clearTimeout(this.timers[key]);this.timers[key]=setTimeout(()=>this.save(key,v),700);}}
 }
 async save(key,v){delete this.timers[key];try{await this.api('/api/state',{key,value:JSON.parse(v)});}catch(e){this.toast('Couldn’t save your changes. Check your connection.');}}
 flushSaves(){for(const key of Object.keys(this.timers)){clearTimeout(this.timers[key]);const v=this.lastSaved[key];try{fetch('/api/state',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-CSRF-Token':this.state.status?.csrf||''},body:JSON.stringify({environment:this.state.env,key,value:JSON.parse(v)})});}catch{}}this.timers={};}
 async loadData(mode=this.state.mode){
  this.setState({busy:'data'});
  try{const data=await this.api(this.envPath(`/api/data?mode=${mode}`));const J0=createEngine(data);
   this.setState({data,mode,booting:false,busy:'',calMonth:mk(J0.TODAY),calDay:'',custom:this.state.custom||{start:`${mk(J0.TODAY)}-01`,end:J0.todayIso},cat:'',merchant:'',limit:40,editTx:''});}
  catch(e){this.setState({booting:false,busy:'',bootError:this.state.data?'':e.message});this.toast(e.message);}
 }
 async switchMode(mode){
  if(mode===this.state.mode)return;this.flushSaves();
  this.setState({...this.groupFrom(`data:${mode}`,mode),msgs:this.store[`chat:${mode}`]?.msgs||[],mode});
  this.lastSaved[`data:${mode}`]=JSON.stringify(this.groupValue(`data:${mode}`,mode,{...this.state,...this.groupFrom(`data:${mode}`,mode)}));
  this.lastSaved[`chat:${mode}`]=JSON.stringify({msgs:(this.store[`chat:${mode}`]?.msgs||[]).slice(-30)});
  await this.loadData(mode);
 }
 async setEnvironment(env){
  if(env===this.state.env)return;localStorage.setItem(ENV_KEY,env);
  await new Promise(r=>this.setState({env,plaidEditing:false,plaidMsg:null},r));
  try{const status=await this.api(this.envPath('/api/status'));this.setState({status});const mode=status.connections?'live':'demo';if(mode!==this.state.mode)await this.switchMode(mode);else await this.loadData(mode);}catch(e){this.toast(e.message);}
 }
 async sync(){
  if(this.state.mode==='demo'){this.toast('Sample data is up to date. Switch to connected accounts to sync.');return;}
  this.setState({busy:'sync'});
  try{const r=await this.api('/api/sync',{}),fails=r.results.filter(x=>!x.ok);this.toast(!r.results.length?'No accounts connected yet.':fails.length?fails.map(x=>`${x.institution}: ${x.error}. Use Reconnect if login is required.`).join(' '):'Synced. Bank data may lag a little behind your bank.');await this.loadData();}
  catch(e){this.toast(e.message);}finally{this.setState({busy:''});}
 }
 loadLink(){return this.linkScript||=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.plaid.com/link/v2/stable/link-initialize.js';s.onload=resolve;s.onerror=()=>{this.linkScript=null;reject(Error('Could not load Plaid Link. Check your connection.'));};document.head.append(s);});}
 async connect(itemId,oauthReturn=false){
  const env=this.state.env;
  if(!this.state.status?.connected){this.toast(`Verify the ${env} Plaid configuration before connecting an account.`);this.go('settings',{setTab:'plaid'});return;}
  this.setState({busy:'connect'});
  try{await this.loadLink();let token=oauthReturn?sessionStorage.getItem('plaid-link-token'):(await this.api('/api/link-token',itemId?{itemId}:{})).link_token;if(!token)throw Error('OAuth session expired. Start the connection again.');
   if(!oauthReturn){sessionStorage.setItem('plaid-link-token',token);sessionStorage.setItem('plaid-update-item',itemId||'');sessionStorage.setItem('plaid-environment',env);}
   const reconnect=itemId||sessionStorage.getItem('plaid-update-item'),handler=window.Plaid.create({token,...(oauthReturn?{receivedRedirectUri:window.location.href}:{}),
    onSuccess:async(public_token,metadata)=>{try{if(!reconnect){const result=await this.api('/api/exchange',{public_token,institution:metadata.institution?.name});this.toast(result.warning||'Account linked. If transactions are still loading, sync again shortly.');}else this.toast('Connection restored. Sync to retrieve updated data.');sessionStorage.removeItem('plaid-link-token');sessionStorage.removeItem('plaid-update-item');history.replaceState({},'','/');const status=await this.api(this.envPath('/api/status'));this.setState({status});if(this.state.mode!=='live')await this.switchMode('live');else await this.loadData('live');}catch(e){this.toast(e.message);}finally{handler.destroy();}},
    onExit:error=>{if(error)this.toast(error.display_message||error.error_code);handler.destroy();}});
   handler.open();}catch(e){this.toast(e.message);}finally{this.setState({busy:''});}
 }
 async signOut(){try{await this.api('/api/auth/sign-out',{});}catch{}location.replace('/login');}
 // ---------- helpers used by pages ----------
 committedSettings(){const S=this.state;return {budgets:S.budgets,density:S.density||'comfortable',reduceMotion:S.reduceMotion,rules:S.rules,env:S.env};}
 dirtyKeys(){const d=this.state.draft;if(!d)return [];const c=this.committedSettings();return Object.keys(d).filter(k=>JSON.stringify(d[k])!==JSON.stringify(c[k]));}
 setDraft(k,fn){this.setState(st=>{const cur={...this.committedSettings(),...(st.draft||{})};return {draft:{...(st.draft||{}),[k]:typeof fn==='function'?fn(cur[k]):fn}};});}
 applyDraft(d,cb){const {env,...rest}=d||{};this.setState({...rest,draft:null,savedAt:new Date().toLocaleTimeString('en-CA',{hour:'numeric',minute:'2-digit'})},()=>{if(env&&env!==this.state.env)this.setEnvironment(env);cb?.();});}
 go(page,extra={}){if(this.state.page==='settings'&&page!=='settings'&&this.dirtyKeys().length){this.setState({leaveTo:{page,extra}});return;}this.setState({page,edit:false,moreOpen:false,showCustom:false,...extra});window.scrollTo({top:0});}
 toast(msg){this.setState({toast:msg});clearTimeout(this._tt);this._tt=setTimeout(()=>this.setState({toast:''}),msg.length>80?5200:2600);}
 money(n,d=0){return money(n,d);}
 short(n){const a=Math.abs(n);return (n<0?'−':'')+(a>=1000?'$'+(a/1000).toFixed(a>=10000?0:1)+'k':'$'+Math.round(a));}
 fmtDate(d){return new Date(`${d}T12:00:00`).toLocaleDateString('en-CA',{month:'short',day:'numeric'});}
 move(id,dir){const l=[...this.state.layout],i=l.indexOf(id),j=i+dir;if(j<0||j>=l.length)return;[l[i],l[j]]=[l[j],l[i]];this.setState({layout:l});}
 engine(){const S=this.state;if(!S.data)return null;const c=this._eng;if(c&&c.d===S.data&&c.r===S.rules&&c.o===S.overrides&&c.b===S.budgets&&c.t===S.tracked)return c.v;const v=createEngine(S.data,{rules:S.rules,overrides:S.overrides,budgets:S.budgets,tracked:S.tracked});this._eng={d:S.data,r:S.rules,o:S.overrides,b:S.budgets,t:S.tracked,v};return v;}
 connectedLoans(J){
  // Loan accounts your bank reports, paired with a detected loan-payment stream when possible.
  if(this.state.mode==='demo')return [];
  const streams=J.fixedStreams.filter(s=>s.type==='loan');
  return J.accounts.filter(a=>a.class==='loan'&&Number.isFinite(+a.balance)).map((a,i,arr)=>{const st=streams.find(s=>s.institution===a.institution)||(arr.length===1&&streams.length===1?streams[0]:null);return {id:`acct-${a.id}`,dir:'owe',name:a.name,who:a.institution,original:+a.balance,balance:+a.balance,payment:st?Math.round(st.typical*100)/100:0,rate:null,day:st?.day||1,connected:true,institution:a.institution};});
 }
 allLoans(J){return [...this.connectedLoans(J),...this.state.loans];}
 async ask(text){
  text=String(text||'').trim();if(!text||this.state.loading)return;
  const msgs=[...this.state.msgs,{role:'user',text,id:Date.now()}];
  this.setState({msgs,input:'',quick:'',loading:true,page:'chat'});window.scrollTo({top:0});
  const history=msgs.slice(-8).map(m=>({role:m.role,content:m.role==='user'?m.text:(m.answer||'…')}));
  while(history.length&&history[0].role!=='user')history.shift();
  try{const r=await this.api('/api/chat',{mode:this.state.mode,messages:history});const p=this.parse(r.text);this.setState(s=>({loading:false,msgs:[...s.msgs,{role:'assistant',id:Date.now(),q:text,...p}]}));}
  catch(e){this.setState(s=>({loading:false,msgs:[...s.msgs,{role:'assistant',id:Date.now(),q:text,error:true,answer:e.code==='AI_NOT_CONFIGURED'?e.message:`I couldn’t reach the assistant just now. ${e.message||''}`.trim(),followups:e.code==='AI_NOT_CONFIGURED'?[]:[text]}]}));}
 }
 parse(raw){const t=String(raw||''),a=t.indexOf('{'),b=t.lastIndexOf('}');try{const o=JSON.parse(t.slice(a,b+1));const pts=o.chart&&Array.isArray(o.chart.points)?o.chart.points.filter(p=>p&&isFinite(Number(p.value))).slice(0,24):[];return {answer:String(o.answer||''),chart:pts.length>1?{type:o.chart.type==='line'?'line':'bar',title:String(o.chart.title||''),points:pts.map(p=>({label:String(p.label),value:Number(p.value)}))}:null,citations:Array.isArray(o.citations)?o.citations.slice(0,6).map(String):[],scenario:o.scenario&&isFinite(Number(o.scenario.monthlyChange))?{title:String(o.scenario.title||'Scenario'),monthlyChange:Number(o.scenario.monthlyChange)}:null,followups:Array.isArray(o.followups)?o.followups.slice(0,3).map(String):[]};}catch{return {answer:t.replace(/```json|```/g,'').trim(),followups:[]};}}
 saveMsg(m){const id='ai'+m.id;if(this.state.saved.some(s=>s.id===id))return;const l=[...this.state.layout],k=l.indexOf('kpis');l.splice(k+1,0,'ai:'+id);this.setState({saved:[...this.state.saved,{id,title:m.q||'Saved answer',answer:m.answer,chart:m.chart,when:new Date().toLocaleDateString('en-CA',{month:'short',day:'numeric'})}],layout:l});this.toast('Saved to Overview');}

 // ---------- shell ----------
 render(_,S){
  if(S.booting||!S.data)return html`<div style="min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center"><div style="display:grid;gap:14px;justify-items:center"><${BrandMark} size=${44}/>${S.bootError?html`<p role="alert" style="margin:0;max-width:420px;color:#7a2f20">Could not load your dashboard: ${S.bootError}</p><button onClick=${()=>location.reload()} style="background:#183c35;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:600;cursor:pointer">Try again</button>`:html`<p style="margin:0;color:#5a6b63">Loading your finances…</p>`}</div></div>`;
  const J=this.engine(),mobile=S.w<820,compact=S.density==='compact',page=S.page;
  const ctx={A:this,S,J,mobile,compact,pad:compact?'16px':mobile?'18px':'24px',gap:compact?'14px':'20px',rowPad:compact?'8px':'13px 8px'};
  const r=J.rangeFor(S.range,S.custom||{start:J.todayIso,end:J.todayIso});ctx.r=r;ctx.all=J.tx;ctx.rows=J.inRange(J.tx,r.start,r.end,S.inst);ctx.prev=J.inRange(J.tx,r.prevStart,r.prevEnd,S.inst);ctx.s=J.summarize(ctx.rows);ctx.ps=J.summarize(ctx.prev);ctx.hasPrev=(ctx.ps.income>0||ctx.ps.spending>0)&&r.prevStart>=J.firstDate;
  const hour=new Date().getHours(),greet=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening',s=ctx.s;
  const titles={overview:[`${greet}, Jainam`,s.income||s.spending?`${r.label}: you kept ${money(s.surplus)} of ${money(s.income)} earned${s.savingsRate!=null?` (${s.savingsRate.toFixed(0)}%)`:''}.`:`${r.label}: no transactions in this range yet.`],spending:['Spending',`Where your money goes, and when · ${r.label}`],projections:['Projections','Where your money is heading, and what a few small changes could do'],transactions:['Transactions',`${r.label} · search, filter and recategorize`],recurring:['Recurring','Bills, subscriptions and anything new that’s started repeating'],loans:['Loans & IOUs','Everything you owe and are owed, including loans your banks can’t see'],chat:['Chat with your finances','Ask anything. Answers come from your own accounts.'],settings:['Settings','Connections, categories, display and security']};
  const showRange=['overview','spending','transactions'].includes(page);
  const Page=Pages[page]||Pages.overview;
  return html`<div class=${S.reduceMotion?'rm':''}>
   <a href="#main" class="skip">Skip to content</a>
   <div style="display:flex;min-height:100vh;background:#f7f8f5">
    ${!mobile?this.sidebar(J):null}
    <main id="main" style=${`flex:1;min-width:0;padding-bottom:${mobile?'88px':'0'}`}>
     ${mobile?html`<div style="position:sticky;top:0;z-index:20;background:#fffffff2;backdrop-filter:blur(8px);border-bottom:1px solid #e2e7df;padding:12px 16px;display:flex;align-items:center;justify-content:space-between"><button onClick=${()=>this.go('overview')} aria-label="jainam. Go to Overview" style="border:0;background:none;cursor:pointer;padding:0;display:flex;align-items:center;gap:9px"><${BrandMark} size=${30}/><${Wordmark} size=${26} dot=${4}/></button><button onClick=${()=>this.signOut()} aria-label="Sign out" title="Sign out" style="background:#eee9df;color:#5f5848;border:0;border-radius:50%;width:34px;height:34px;display:grid;place-items:center;font-size:12px;font-weight:700;cursor:pointer">JS</button></div>`:null}
     <div style=${`max-width:1320px;margin:0 auto;padding:${mobile?'16px 16px 24px':'28px 36px 40px'};display:grid;gap:${ctx.gap}`}>
      <header style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;padding-top:8px">
       <div style="min-width:0"><h1 style="font:400 36px/1.15 'Instrument Serif',serif;letter-spacing:-1.1px;margin:0;color:#183c35">${titles[page][0]}</h1><p style="margin:6px 0 0;font-size:15px;color:#5a6b63;text-wrap:pretty">${titles[page][1]}</p></div>
       ${showRange?this.rangeControls(J):null}
      </header>
      ${S.mode==='demo'&&page!=='settings'?html`<div role="note" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#eef3f8;border:1px solid #d6e2ee;border-radius:12px;padding:10px 14px;font-size:13px;color:#2c4a63"><span><b>Sample data.</b> These are made-up accounts, not your real balances.</span>${S.status?.connections?html`<button onClick=${()=>this.switchMode('live')} class="hv-border" style="border:1px solid #b9cde0;background:#fff;border-radius:999px;padding:5px 12px;font-size:13px;font-weight:600;color:#183c35;cursor:pointer">View connected accounts</button>`:html`<button onClick=${()=>this.go('settings',{setTab:'connections'})} class="hv-border" style="border:1px solid #b9cde0;background:#fff;border-radius:999px;padding:5px 12px;font-size:13px;font-weight:600;color:#183c35;cursor:pointer">Connect your banks</button>`}</div>`:null}
      ${S.showCustom&&showRange?this.customPanel(J,mobile):null}
      <${Page} ...${ctx}/>
     </div>
     ${mobile?this.mobileNav():null}
     ${S.leaveTo?this.leaveDialog():null}
     <div role="status" aria-live="polite" style=${`position:fixed;left:50%;transform:translateX(-50%);bottom:${mobile?'96px':'24px'};z-index:40;pointer-events:none;max-width:min(560px,calc(100vw - 32px))`}>${S.toast?html`<div style="background:#183c35;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;box-shadow:0 8px 24px #183c3533">${S.toast}</div>`:null}</div>
    </main>
   </div>
  </div>`;
 }
 navItems(){const S=this.state;return PAGES.map(([id,label,short])=>({id,label,short,active:S.page===id}));}
 sidebar(J){
  const S=this.state,envLabel=S.env==='sandbox'?'Sandbox':'Production',last=S.data.connections?.map(c=>c.synced).filter(Boolean).sort().at(-1);
  return html`<aside aria-label="Main" style="width:240px;flex:none;background:#fff;border-right:1px solid #e2e7df;padding:28px 16px 20px;display:flex;flex-direction:column;gap:28px;position:sticky;top:0;height:100vh;overflow-y:auto">
   <button onClick=${()=>this.go('overview')} aria-label="jainam. Go to Overview" title="Go to Overview" class="hv-soft" style="border:0;background:none;cursor:pointer;border-radius:12px;display:flex;align-items:center;gap:11px;padding:4px 8px;text-align:left;transition:background .15s"><${BrandMark}/><${Wordmark}/></button>
   <nav style="display:grid;gap:4px">${this.navItems().map(n=>{const chat=n.id==='chat',bg=n.active?'#eff4e9':'#fff';return html`<button onClick=${()=>this.go(n.id)} aria-current=${n.active?'page':undefined} class=${chat?'navchat':'navbtn'} style=${`--f:${bg};display:flex;align-items:center;gap:12px;padding:5px 8px 5px 5px;border:2px solid transparent;border-radius:12px;background:${n.active?'#eff4e9':'transparent'};color:${n.active?'#183c35':'#4f5f57'};font-size:14px;font-weight:${n.active?700:500};text-align:left;cursor:pointer;min-height:48px`}><span aria-hidden="true" style=${`width:34px;height:34px;flex:none;display:grid;place-items:center;border-radius:9px;background:${n.active?'#183c35':'transparent'};color:${n.active?'#d1e5a7':'#4f6b5e'};transition:background .15s,color .15s`}><${NavIcon} id=${n.id} sw=${n.active?2:1.75}/></span><span style="flex:1">${n.label}</span>${chat?html`<span style="font-size:11px;font-weight:700;letter-spacing:.4px;background:#d1e5a7;color:#183c35;padding:2px 7px;border-radius:20px">AI</span>`:null}</button>`;})}</nav>
   <div style="margin-top:auto;display:grid;gap:14px">
    <div style="background:#f3f6ef;border:1px solid #e2e7df;border-radius:10px;padding:12px;display:grid;gap:6px"><div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600"><span aria-hidden="true" style=${`width:8px;height:8px;border-radius:50%;background:${S.env==='sandbox'?'#39789d':'#3f6a39'}`}></span>${envLabel} · ${S.mode==='demo'?'sample data':'connected'}</div><div style="font-size:12px;color:#5a6b63">${S.mode==='demo'?'Made-up accounts for exploring':last?`Synced ${new Date(last).toLocaleString('en-CA',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`:'Not synced yet'}</div>
     <div style="display:flex;gap:6px;flex-wrap:wrap"><button onClick=${()=>this.sync()} disabled=${S.busy==='sync'} class="hv-e6" style="justify-self:start;display:inline-flex;align-items:center;gap:6px;border:1px solid #cfdccb;background:#fff;border-radius:999px;padding:5px 12px;font-size:13px;font-weight:600;color:#183c35;cursor:pointer;transition:background .15s"><span aria-hidden="true">↻</span>${S.busy==='sync'?'Syncing…':'Sync now'}</button>
     ${S.status?.connections||S.mode==='live'?html`<button onClick=${()=>this.switchMode(S.mode==='demo'?'live':'demo')} class="hv-e6" style="border:1px solid #cfdccb;background:#fff;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:600;color:#183c35;cursor:pointer">${S.mode==='demo'?'Use my accounts':'View sample'}</button>`:null}</div></div>
    <div style="display:flex;gap:10px;align-items:center;border-top:1px solid #e2e7df;padding:14px 8px 0"><b aria-hidden="true" style="background:#eee9df;color:#5f5848;border-radius:50%;width:36px;height:36px;display:grid;place-items:center;font-size:12px;flex:none">JS</b><div style="flex:1;min-width:0;font-size:14px;font-weight:600">Jainam Shah<div style="font-size:12px;font-weight:400;color:#5a6b63">Private workspace</div></div><button onClick=${()=>this.signOut()} aria-label="Sign out" title="Sign out" class="hv-ee" style="border:1px solid #cdd6ca;background:#fff;border-radius:8px;width:36px;height:36px;display:grid;place-items:center;color:#183c35;flex:none;transition:background .15s;cursor:pointer"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5"></path><path d="M21 12H9"></path></svg></button></div>
   </div>
  </aside>`;
 }
 rangeControls(J){
  const S=this.state,ca=S.range==='custom',r=J.rangeFor(S.range,S.custom||{start:J.todayIso,end:J.todayIso});
  const presets=[['month','This month'],['last-month','Last month'],['3m','3M'],['6m','6M'],['12m','1Y'],['ytd','YTD'],['24m','2Y']];
  const insts=[...new Set(J.accounts.map(a=>a.institution))];
  const toggle=()=>{const end=S.custom?.end||J.todayIso,d=new Date(`${end}T12:00:00`);d.setMonth(d.getMonth()-1);this.setState({showCustom:!S.showCustom,cStart:S.custom?.start||'',cEnd:S.custom?.end||'',cpMonth:mk(d)});};
  return html`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
   <div role="group" aria-label="Date range" style="display:flex;flex-wrap:wrap;gap:2px;background:#edf0e9;border:1px solid #dfe5db;border-radius:10px;padding:3px">${presets.map(([id,label])=>{const a=S.range===id;return html`<button onClick=${()=>this.setState({range:id,limit:40,calDay:'',showCustom:false})} aria-pressed=${a} style=${`border:0;border-radius:7px;padding:7px 11px;font-size:13px;font-weight:${a?700:500};background:${a?'#fff':'transparent'};color:${a?'#183c35':'#4f5f57'};box-shadow:${a?'0 1px 3px #183c3522':'none'};cursor:pointer;min-height:34px`}>${label}</button>`;})}</div>
   <button onClick=${toggle} aria-expanded=${S.showCustom} aria-pressed=${ca} class="hv-border" style=${`display:inline-flex;align-items:center;gap:8px;border:1px solid ${ca?'#183c35':'#cdd6ca'};background:${ca?'#183c35':'#fff'};color:${ca?'#fff':'#183c35'};border-radius:10px;padding:7px 12px;font-size:14px;font-weight:600;cursor:pointer;min-height:42px;transition:border-color .15s`}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke=${ca?'#d1e5a7':'#4f7f63'} stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5"></rect><path d="M8 2.5v4"></path><path d="M16 2.5v4"></path><path d="M3 10h18"></path></svg>${ca?r.label:'Custom'}</button>
   <${Select} value=${S.inst} options=${[{value:'',label:'All institutions'},...insts.map(n=>({value:n,label:n,logo:true}))]} onChange=${v=>this.setState({inst:v})} label="Institution" hideLabel=${true} icon="bank" minWidth="200px" align="right"/>
  </div>`;
 }
 customPanel(J,mobile){
  const S=this.state,cs=S.cStart,ce=S.cEnd,today=J.todayIso,minD=J.firstDate,fd=d=>new Date(`${d}T12:00:00`).toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
  const nM=mobile?1:2,addM=(m,n)=>{const d=new Date(`${m}-15T12:00:00`);d.setMonth(d.getMonth()+n);return mk(d);},lastLeft=addM(mk(J.TODAY),-(nM-1)),minM=minD.slice(0,7),cp=S.cpMonth||lastLeft,left=cp>lastLeft?lastLeft:cp<minM?minM:cp;
  const pick=d=>{if(!cs||ce)this.setState({cStart:d,cEnd:''});else if(d<cs)this.setState({cStart:d});else this.setState({cEnd:d});};
  const ago=n=>{const d=new Date(J.TODAY);d.setDate(d.getDate()-n);return iso(d);},y=J.TODAY.getFullYear(),m=J.TODAY.getMonth(),sumY=m>=8?y:y-1,holY=(m===11&&J.TODAY.getDate()>=15)||m===0?(m===0?y-1:y):y-1;
  const quick=[['Last 7 days',ago(6),today],['Last 30 days',ago(29),today],['Last 90 days',ago(89),today],['This year',`${y}-01-01`,today],[String(y-1),`${y-1}-01-01`,`${y-1}-12-31`],[`Summer ${sumY}`,`${sumY}-06-01`,`${sumY}-08-31`],[`Holidays ${holY}`,`${holY}-11-15`,`${holY+1}-01-05`]].filter(([,a,b])=>b>=minD&&a<=today);
  const months=[...Array(nM)].map((_,k)=>{const mo=addM(left,k),[yy,mm]=mo.split('-').map(Number),first=new Date(yy,mm-1,1,12),dim=new Date(yy,mm,0).getDate(),days=[];for(let i=0;i<first.getDay();i++)days.push(null);
   for(let dd=1;dd<=dim;dd++){const d=`${mo}-${String(dd).padStart(2,'0')}`,off=d<minD||d>today,isS=d===cs,isE=d===ce,inR=!!(cs&&ce&&d>cs&&d<ce),end=isS||isE,isT=d===today,dow=new Date(yy,mm-1,dd).getDay(),bandOn=cs&&ce&&cs!==ce&&(inR||end);
    days.push({d,dd,off,end,isT,inR,isS,isE,band:bandOn?'#e2ecd9':'transparent',bandR:isS&&bandOn?'10px 0 0 10px':isE&&bandOn?'0 10px 10px 0':inR&&dow===0?'10px 0 0 10px':inR&&dow===6?'0 10px 10px 0':'0',aria:`${new Date(yy,mm-1,dd).toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}${isS?', start date':''}${isE?', end date':''}${inR?', in range':''}`});}
   return {mo,label:mLong(mo),days,k};});
  const bad=!cs||!ce,days=bad?0:Math.round((new Date(ce)-new Date(cs))/864e5)+1;
  const apply=e=>{e.preventDefault();if(bad)return;this.setState({range:'custom',custom:{start:cs,end:ce},showCustom:false,limit:40,calDay:''});};
  const navBtn=(label,vis,off,fn,ch)=>html`<button type="button" onClick=${fn} disabled=${off} aria-label=${label} class="hv-ee" style=${`visibility:${vis?'visible':'hidden'};width:34px;height:34px;border:1px solid #dfe5db;background:#fff;border-radius:50%;cursor:pointer;color:#183c35;font-size:16px`}>${ch}</button>`;
  return html`<form onSubmit=${apply} aria-label="Custom date range" style=${`background:#fff;border:1px solid #cdd6ca;border-radius:16px;box-shadow:0 14px 40px #183c3518;display:grid;grid-template-columns:${mobile?'1fr':'190px minmax(0,1fr)'};overflow:hidden;animation:jsfin .2s ease-out`}>
   <div style="background:#f5f8f1;border-right:1px solid #e2e7df;padding:16px 12px;display:grid;gap:2px;align-content:start"><b style="font:600 14px 'Geist',sans-serif;margin:0 0 8px 10px">Quick picks</b>
    ${quick.map(([label,a,b])=>{const sel=cs===a&&ce===b;return html`<button type="button" onClick=${()=>this.setState({cStart:a<minD?minD:a,cEnd:b>today?today:b,cpMonth:addM(b.slice(0,7)>mk(J.TODAY)?mk(J.TODAY):b.slice(0,7),-(nM-1))})} aria-pressed=${sel} class="hv-e6" style=${`display:flex;justify-content:space-between;text-align:left;border:0;background:${sel?'#183c35':'transparent'};color:${sel?'#fff':'#183c35'};font-weight:${sel?700:500};padding:9px 10px;border-radius:8px;font-size:14px;cursor:pointer;transition:background .15s`}>${label}<span aria-hidden="true">${sel?'✓':''}</span></button>`;})}
   </div>
   <div style="padding:16px 18px;display:grid;gap:14px;min-width:0">
    <div style="display:flex;gap:10px;align-items:stretch;flex-wrap:wrap">
     <div style=${`flex:1;min-width:150px;border:1px solid ${!cs?'#315e4e':'#cdd6ca'};box-shadow:${!cs?'0 0 0 3px #d1e5a799':'none'};border-radius:10px;padding:8px 12px`}><div style="font-size:12px;color:#5a6b63;font-weight:600">From</div><div style="font-size:15px;font-weight:600">${cs?fd(cs):'Pick a start date'}</div></div>
     <span aria-hidden="true" style="align-self:center;color:#5a6b63">→</span>
     <div style=${`flex:1;min-width:150px;border:1px solid ${cs&&!ce?'#315e4e':'#cdd6ca'};box-shadow:${cs&&!ce?'0 0 0 3px #d1e5a799':'none'};border-radius:10px;padding:8px 12px`}><div style="font-size:12px;color:#5a6b63;font-weight:600">To</div><div style=${`font-size:15px;font-weight:600;color:${ce?'#183c35':'#5a6b63'}`}>${ce?fd(ce):cs?'Now pick an end date':'—'}</div></div>
    </div>
    <div style=${`display:grid;grid-template-columns:repeat(${nM},minmax(0,1fr));gap:20px`}>
     ${months.map(cm=>html`<div style="display:grid;gap:6px;align-content:start">
      <div style="display:flex;align-items:center;justify-content:space-between">${navBtn('Previous month',cm.k===0,left<=minM,()=>this.setState({cpMonth:addM(left,-1)}),'‹')}<b style="font:600 14px 'Geist',sans-serif;white-space:nowrap">${cm.label}</b>${navBtn('Next month',cm.k===nM-1,addM(left,nM-1)>=mk(J.TODAY),()=>this.setState({cpMonth:addM(left,1)}),'›')}</div>
      <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));row-gap:2px">
       ${['S','M','T','W','T','F','S'].map(wl=>html`<span aria-hidden="true" style="font-size:12px;font-weight:600;color:#5a6b63;text-align:center;padding:4px 0">${wl}</span>`)}
       ${cm.days.map(d=>!d?html`<div></div>`:html`<div style=${`background:${d.band};border-radius:${d.bandR};display:grid`}><button type="button" onClick=${()=>pick(d.d)} disabled=${d.off} aria-label=${d.aria} aria-pressed=${d.end} class="hv-border" style=${`height:38px;border:1px solid ${d.isT&&!d.end?'#315e4e':'transparent'};background:${d.end?'#183c35':'transparent'};color:${d.end?'#fff':d.off?'#7d8a83':'#183c35'};border-radius:10px;font-size:14px;font-weight:${d.end||d.isT?700:500};cursor:pointer;opacity:${d.off?.45:1};font-variant-numeric:tabular-nums`}>${d.dd}</button></div>`)}
      </div></div>`)}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid #eef1ea;padding-top:12px"><span aria-live="polite" style="font-size:13px;color:#3d4d45">${bad?(cs?'Select the last day of your range':'Select the first day of your range'):`${days} day${days>1?'s':''} selected`}</span><div style="display:flex;gap:8px"><button type="button" onClick=${()=>this.setState({showCustom:false})} style="background:#fff;border:1px solid #cdd6ca;padding:9px 14px;border-radius:10px;font-size:14px;font-weight:600;color:#183c35;cursor:pointer;min-height:42px">Cancel</button><button type="submit" disabled=${bad} style=${`background:#183c35;border:1px solid #183c35;padding:9px 18px;border-radius:10px;font-size:14px;font-weight:600;color:#fff;cursor:pointer;min-height:42px;opacity:${bad?.5:1}`}>Apply range</button></div></div>
   </div>
  </form>`;
 }
 mobileNav(){
  const S=this.state,moreIds=['recurring','loans','projections','settings'],moreActive=moreIds.includes(S.page),items=this.navItems(),of=id=>items.find(n=>n.id===id);
  const tabs=[...['overview','spending','chat','transactions'].map(of),{id:'more',short:'More',active:moreActive,more:true}];
  return html`${S.moreOpen?html`<div onClick=${()=>this.setState({moreOpen:false})} aria-hidden="true" style="position:fixed;inset:0;background:#183c3540;z-index:29"></div><div role="dialog" aria-label="More pages" style="position:fixed;left:8px;right:8px;bottom:78px;z-index:31;background:#fff;border-radius:16px;padding:8px;box-shadow:0 -10px 40px #183c3530;display:grid;gap:2px;animation:jsfin .18s ease-out">${moreIds.map(of).map(n=>html`<button onClick=${()=>this.go(n.id)} aria-current=${n.active?'page':undefined} style=${`display:flex;align-items:center;gap:12px;padding:14px;border:0;background:${n.active?'#eff4e9':'transparent'};border-radius:10px;font-size:15px;font-weight:600;text-align:left;cursor:pointer;min-height:48px;color:#183c35`}><span aria-hidden="true" style=${`width:34px;height:34px;flex:none;display:grid;place-items:center;border-radius:9px;background:${n.active?'#183c35':'transparent'};color:${n.active?'#d1e5a7':'#4f6b5e'}`}><${NavIcon} id=${n.id} sw=${n.active?2:1.75}/></span>${n.label}</button>`)}<button onClick=${()=>this.signOut()} style="display:flex;align-items:center;gap:12px;padding:14px;border:0;background:transparent;border-radius:10px;font-size:15px;font-weight:600;text-align:left;cursor:pointer;min-height:48px;color:#9a3d2a"><span aria-hidden="true" style="width:34px;height:34px;display:grid;place-items:center">⇥</span>Sign out</button></div>`:null}
  <nav aria-label="Main" style="position:fixed;left:0;right:0;bottom:0;z-index:30;background:#fff;border-top:1px solid #e2e7df;display:grid;grid-template-columns:repeat(5,1fr);padding:6px 4px calc(6px + env(safe-area-inset-bottom))">
   ${tabs.map(n=>html`<button onClick=${()=>n.more?this.setState({moreOpen:!S.moreOpen}):this.go(n.id)} aria-current=${n.active?'page':undefined} aria-expanded=${n.more?S.moreOpen:undefined} style=${`border:0;background:transparent;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;min-height:52px;color:${n.active?'#183c35':'#4f5f57'};cursor:pointer`}><span aria-hidden="true" style=${`width:48px;height:30px;display:grid;place-items:center;border-radius:15px;background:${n.active||(n.more&&S.moreOpen)?'#dfeacb':'transparent'}`}><${NavIcon} id=${n.id} size=${22} sw=${n.active?2:1.75}/></span><span style=${`font-size:12px;font-weight:${n.active?700:500}`}>${n.short}</span></button>`)}
  </nav>`;
 }
 dirtyText(){const L={budgets:'budgets',density:'density',reduceMotion:'reduce motion',rules:'category rules',env:'Plaid environment'},k=this.dirtyKeys().map(x=>L[x]);return k.length?k.join(', ').replace(/^./,c=>c.toUpperCase()):'';}
 leaveDialog(){
  const t=this.state.leaveTo;
  return html`<div style="position:fixed;inset:0;z-index:70;background:#183c3566;display:grid;place-items:center;padding:16px;animation:jsfin .15s ease-out" onKeyDown=${e=>{if(e.key==='Escape')this.setState({leaveTo:null});}}><div role="dialog" aria-modal="true" aria-labelledby="lv-h" style="background:#fff;border-radius:18px;max-width:460px;width:100%;padding:26px;display:grid;gap:12px;box-shadow:0 24px 60px #183c3540"><h2 id="lv-h" style="font:400 30px/1.15 'Instrument Serif',serif;margin:0;letter-spacing:-.3px">Save your settings?</h2><p style="margin:0;font-size:15px;color:#3d4d45;line-height:1.55">You changed <b>${this.dirtyText()}</b>. These changes won’t apply until you save them.</p><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:8px"><button onClick=${()=>this.setState({leaveTo:null})} style="background:#fff;border:1px solid #cdd6ca;padding:9px 14px;border-radius:10px;font-size:14px;font-weight:600;color:#183c35;cursor:pointer;min-height:42px;margin-right:auto">Keep editing</button><button onClick=${()=>this.setState({draft:null,leaveTo:null},()=>this.go(t.page,t.extra))} style="background:#fff;border:1px solid #efcfc5;padding:9px 14px;border-radius:10px;font-size:14px;font-weight:600;color:#9a3d2a;cursor:pointer;min-height:42px">Discard</button><button ref=${el=>el&&!this._lvf&&(this._lvf=1,setTimeout(()=>{el.focus();this._lvf=0;},0))} onClick=${()=>{const d=this.state.draft;this.setState({leaveTo:null});this.applyDraft(d,()=>{this.toast('Settings saved');this.go(t.page,t.extra);});}} style="background:#183c35;border:1px solid #183c35;padding:9px 16px;border-radius:10px;font-size:14px;font-weight:600;color:#fff;cursor:pointer;min-height:42px">Save & continue</button></div></div></div>`;
 }
}

render(html`<${App}/>`,document.getElementById('app'));
