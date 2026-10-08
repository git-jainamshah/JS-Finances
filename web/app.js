import {summarize} from '/finance.mjs';
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,currency='CAD')=>n==null?'Unavailable':new Intl.NumberFormat('en-CA',{style:'currency',currency,maximumFractionDigits:0}).format(n);
const exactMoney=(n,currency='CAD')=>n==null?'Unavailable':new Intl.NumberFormat('en-CA',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const now=new Date(), months=Array.from({length:6},(_,i)=>dateKey(new Date(now.getFullYear(),now.getMonth()-5+i,1)));
const shortMonth=m=>new Date(`${m}-15T12:00:00`).toLocaleDateString('en-CA',{month:'short'});
const savedEnvironment=localStorage.getItem('finance-plaid-environment');
let data,status,plaidSettings,activeEnv=['sandbox','production'].includes(savedEnvironment)?savedEnvironment:'sandbox',mode='demo',period=months.at(-1),category='',limit=30;
const notice=text=>{ $('notice').hidden=!text;$('notice').textContent=text; };
async function api(path,body){const includeEnvironment=!path.startsWith('/api/auth/'),payload=body&&includeEnvironment?{environment:activeEnv,...body}:body;const r=await fetch(path,payload?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':status?.csrf||''},body:JSON.stringify(payload)}:{});if(r.status===401){location.replace('/login');throw Error('Your session expired. Please sign in again.');}const d=await r.json();if(!r.ok)throw Error(d.error || d.message || 'Request failed');return d;}
const environmentPath=path=>`${path}${path.includes('?')?'&':'?'}env=${activeEnv}`;
const bankRows=()=>data.transactions.filter(t=>!$('institution').value || t.institution===$('institution').value);
const selectedRows=()=>bankRows().filter(t=>period==='six'?months.includes(t.date.slice(0,7)):t.date.startsWith(period));
function metric(label,value,note,symbol){return `<div class="metric"><div class="metric-label">${label}<span>${symbol}</span></div><strong>${value}</strong><small>${note}</small></div>`;}
function render(){
 const rows=selectedRows(),s=summarize(rows),name=period==='six'?'Across 6 calendar months':`${shortMonth(period)}${period===months.at(-1)?' · month to date':''}`;
 $('metrics').innerHTML=metric('Net cash flow',money(s.surplus),`${name} · income less spending`,'↗')+metric('Income',money(s.income),'Classified income · refunds excluded','↓')+metric('Spending',money(s.spending),'Net of refunds · transfers excluded','↑')+metric('Savings rate',s.savingsRate==null?'—':`${s.savingsRate.toFixed(1)}%`,'Surplus ÷ income · cash-flow measure','◷');
 const series=months.map(m=>({month:m,...summarize(bankRows().filter(t=>t.date.startsWith(m)))}));const max=Math.max(1,...series.flatMap(s=>[s.income,s.spending]));
 $('cash-chart').innerHTML=series.map(s=>`<button class="bar-group ${period===s.month?'selected-month':''}" data-month="${s.month}" title="${shortMonth(s.month)}: income ${money(s.income)}, spending ${money(s.spending)}" aria-label="Filter ${shortMonth(s.month)}. Income ${money(s.income)}. Spending ${money(s.spending)}"><div class="bars"><div class="bar" style="height:${Math.max(0,s.income)/max*95}%"></div><div class="bar out" style="height:${Math.max(0,s.spending)/max*95}%"></div></div><span class="bar-label">${shortMonth(s.month)}</span></button>`).join('');
 document.querySelectorAll('[data-month]').forEach(el=>el.onclick=()=>setPeriod(el.dataset.month));
 const cats={};rows.filter(t=>!t.pending && t.currency==='CAD' && ['expense','refund'].includes(t.kind)).forEach(t=>cats[t.category]=(cats[t.category]||0)+t.amount);
 const sorted=Object.entries(cats).sort((a,b)=>b[1]-a[1]),catMax=Math.max(1,...Object.values(cats));
 $('category-chart').innerHTML=sorted.length?sorted.slice(0,6).map(([c,n],i)=>`<button class="category-row" data-category="${esc(c)}" aria-pressed="${category===c}"><div class="category-top"><span>${category===c?'● ':''}${esc(c)}</span><b>${money(n)}</b></div><div class="track"><div style="width:${Math.max(0,n)/catMax*100}%;background:${['#426953','#8aa378','#b3c28d','#d6c6a1','#c38f70','#879790'][i]}"></div></div></button>`).join(''):'<p class="empty">No posted CAD spending in this period.</p>';
 document.querySelectorAll('[data-category]').forEach(el=>el.onclick=()=>{category=el.dataset.category;limit=30;render();$('transactions').scrollIntoView({behavior:'smooth'});});$('clear-category').hidden=!category;
 const accounts=data.accounts.filter(a=>!$('institution').value || a.institution===$('institution').value);
 $('accounts').innerHTML=accounts.length?accounts.map(a=>`<article class="account"><div class="bank-icon ${a.institution==='RBC'?'rbc':a.institution.includes('Express')?'amex':''}">${esc(a.institution.slice(0,1))}</div><div><h3>${esc(a.institution)}</h3><p>${esc(a.name)} · ${esc(a.mask||'••••')}</p><strong>${['CAD','USD'].includes(a.currency)?exactMoney(a.balance,a.currency):esc(a.balance??'Unavailable')+' '+esc(a.currency)}</strong><small>${a.type==='credit'?'Outstanding balance':'Current balance'}</small></div></article>`).join(''):'<p class="empty">Connect an account to see its balance here.</p>';
 renderForecast();renderInsights(sorted,rows);renderTransactions();renderConnections();
 document.querySelectorAll('.segmented button').forEach(b=>b.classList.remove('selected'));if(period===months.at(-1))$('period-month').classList.add('selected');else if(period===months.at(-2))$('period-last').classList.add('selected');else if(period==='six')$('period-six').classList.add('selected');
}
function renderForecast(){
 const complete=months.slice(-4,-1),history=bankRows().filter(t=>complete.includes(t.date.slice(0,7))),covered=complete.every(m=>history.some(t=>t.date.startsWith(m)&&!t.pending&&t.currency==='CAD'));
 const accounts=data.accounts.filter(a=>(!$('institution').value||a.institution===$('institution').value)&&a.type==='depository'&&a.currency==='CAD');
 const reduction=Number($('reduction').value)/100;$('reduction-label').textContent=`${Math.round(reduction*100)}%`;
 if(!covered||!accounts.length||accounts.some(a=>a.balance==null)){$('forecast-total').textContent='More data needed';$('forecast-chart').innerHTML='<p class="empty">Add CAD cash accounts and transactions in each of the last three complete months to calculate a scenario.</p>';$('forecast-assumptions').textContent='History availability does not guarantee completeness. Verify imported data before relying on projections.';return;}
 const sum=summarize(history),income=sum.income/3,spend=sum.spending/3,opening=accounts.reduce((s,a)=>s+a.balance,0),delta=income-spend*(1-reduction),values=[opening,opening+delta,opening+delta*2,opening+delta*3];
 $('forecast-total').textContent=money(values[3]);const lo=Math.min(...values)-500,hi=Math.max(...values)+500;const points=values.map((v,i)=>[i*165+15,90-(v-lo)/(hi-lo)*75]);
 $('forecast-chart').innerHTML=`<svg viewBox="0 0 535 130" role="img" aria-label="Cash scenario: today ${money(values[0])}, 30 days ${money(values[1])}, 60 days ${money(values[2])}, 90 days ${money(values[3])}"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b0c88b" stop-opacity=".45"/><stop offset="1" stop-color="#b0c88b" stop-opacity="0"/></linearGradient></defs><path d="M${points.map(p=>p.join(',')).join(' L')} L510,100 L15,100 Z" fill="url(#fill)"/><polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#527546" stroke-width="2.5"/>${points.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="4" fill="#527546"><title>${i*30} days: ${money(values[i])}</title></circle><text x="${x}" y="124" text-anchor="${i===0?'start':i===3?'end':'middle'}">${i===0?'Today':i*30+' days'}</text>`).join('')}</svg>`;
 $('forecast-assumptions').textContent=`Monthly baseline: ${money(income)} income − ${money(spend)} spending. Starts with ${money(opening)} cash. Assumes 30-day months and unchanged income; excludes transfers, debt settlement, interest and investment returns. Card purchases count as spending. This is an illustrative scenario, not a bill-by-bill balance forecast; history may be incomplete.`;
}
function renderInsights(sorted,rows){
 const top=sorted.find(([,n])=>n>0);const fees=rows.filter(t=>!t.pending&&t.currency==='CAD'&&t.category==='Bank fees').reduce((s,t)=>s+t.amount,0);
 const needs=rows.filter(t=>t.review).length;const insights=[];
 if(top)insights.push(['Start with your biggest category',`${esc(top[0])} totals <strong>${money(top[1])}</strong> in this period. A 10% reduction would leave ${money(top[1]*.1)} more. Check which costs are actually flexible.`]);
 const merchants=new Map();bankRows().filter(t=>!t.pending&&t.currency==='CAD'&&t.kind==='expense').forEach(t=>{const key=t.name;const r=merchants.get(key)||{months:new Set(),amounts:[]};r.months.add(t.date.slice(0,7));r.amounts.push(t.amount);merchants.set(key,r);});
 const recurring=[...merchants].filter(([,r])=>r.months.size>=3&&r.amounts.length<=r.months.size+1&&Math.max(...r.amounts)-Math.min(...r.amounts)<2);
 if(recurring.length)insights.push(['Review recurring charges',`${recurring.length} merchants show similar charges across at least 3 months: ${recurring.slice(0,3).map(([n])=>esc(n)).join(', ')}. These are candidates to review, not confirmed subscriptions.`]);
 if(fees>0)insights.push(['Check account fees',`You paid <strong>${money(fees)}</strong> in classified bank fees. Review whether your account’s fee-waiver conditions fit your balance.`]);
 insights.push(['Know what’s included',`${needs} transactions have uncertain categories. ${rows.filter(t=>t.pending).length} pending transactions and ${rows.filter(t=>t.currency!=='CAD').length} non-CAD transactions are excluded from metrics. Review transfers and refunds for correct classification.`]);
 $('insights').innerHTML=insights.slice(0,3).map(([title,body])=>`<div class="insight"><h3>${title}</h3><p>${body}</p></div>`).join('');
}
function renderTransactions(){
 const query=$('search').value.toLowerCase();const rows=selectedRows().filter(t=>(!category||t.category===category)&&`${t.name} ${t.category} ${t.institution}`.toLowerCase().includes(query));
 $('transaction-count').textContent=`${rows.length} transactions${category?' · '+category:''} · ${period==='six'?'last 6 calendar months':period}`;
 $('transaction-rows').innerHTML=rows.slice(0,limit).map(t=>`<tr><td>${esc(t.date)}</td><td>${esc(t.name)}${t.pending?' <small>Pending</small>':''}${t.review?' <small>Review</small>':''}</td><td><span class="tag">${esc(t.category)}</span></td><td>${esc(t.institution)}</td><td class="amount ${t.amount<0?'incoming':''}">${t.amount<0?'+':'−'}${['CAD','USD'].includes(t.currency)?exactMoney(Math.abs(t.amount),t.currency):esc(Math.abs(t.amount))} <small>${esc(t.currency)}</small></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No transactions match these filters.</td></tr>';
 $('table-status').textContent=`Showing ${Math.min(limit,rows.length)} of ${rows.length} · + received / − paid`;$('show-more').hidden=rows.length<=limit;
}
function renderConnections(){
 $('connection-list').innerHTML=data.demo?'<p class="empty">Scotiabank, RBC and Amex above are sample accounts. Connect each institution through Plaid when your credentials are configured.</p>':data.connections.length?data.connections.map(i=>`<div class="connection-row"><div>${esc(i.institution)}<small>${i.synced?'Last local sync: '+esc(new Date(i.synced).toLocaleString()):'Waiting for first sync'}</small></div><button class="button" data-reconnect="${esc(i.id)}">Reconnect</button></div>`).join(''):'<p class="empty">No accounts connected in this Plaid environment yet.</p>';
 document.querySelectorAll('[data-reconnect]').forEach(b=>b.onclick=()=>connect(b.dataset.reconnect));
}
function setPeriod(p){period=p;limit=30;category='';render();}
async function load(){data=await api(environmentPath(`/api/data?mode=${mode}`));const current=$('institution').value;const institutions=[...new Set(data.accounts.map(a=>a.institution))];$('institution').innerHTML='<option value="">All institutions</option>'+institutions.map(n=>`<option>${esc(n)}</option>`).join('');if(institutions.includes(current))$('institution').value=current;
 $('mode-message').textContent=mode==='demo'?`◉  Exploring sample data in the ${activeEnv} view. These are not your actual balances or transactions.`:activeEnv==='sandbox'?'◉  Sandbox environment: connected test accounts, not real financial data.':'◉  Production account data. Metrics include posted CAD transactions only.';
 $('mode-toggle').textContent=mode==='demo'?'View connected accounts →':'Explore sample dashboard →';render();}
function renderEnvironment(){
 for(const id of ['env-sandbox','config-sandbox'])$(id).classList.toggle('selected',activeEnv==='sandbox');
 for(const id of ['env-production','config-production'])$(id).classList.toggle('selected',activeEnv==='production');
 const saved=plaidSettings?.environments?.[activeEnv];$('plaid-config-badge').textContent=saved?.configured?'Configured':'Not configured';
 $('plaid-secret-label').textContent=`${activeEnv[0].toUpperCase()+activeEnv.slice(1)} secret`;
 $('plaid-environment-help').textContent=activeEnv==='sandbox'?'Test with simulated institutions and transactions. Nothing here connects to a real bank.':'Use live institution credentials only after Plaid grants Production access.';
 const form=$('plaid-config-form');form.clientId.placeholder=saved?.configured?'Saved securely — enter both values to replace':'Enter client ID';form.secret.placeholder=saved?.configured?'Saved securely — enter both values to replace':'Enter environment secret';
}
async function loadPlaidSettings(){plaidSettings=await api('/api/plaid-config');renderEnvironment();}
async function setEnvironment(environment){
 if(environment===activeEnv)return;activeEnv=environment;localStorage.setItem('finance-plaid-environment',activeEnv);category='';limit=30;period=months.at(-1);notice('');renderEnvironment();
 try{status=await api(environmentPath('/api/status'));mode=status.connections?'live':'demo';await load();}catch(e){notice(e.message);}
}
let linkScript;
function loadLink(){return linkScript ||= new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.plaid.com/link/v2/stable/link-initialize.js';s.onload=resolve;s.onerror=()=>{linkScript=null;reject(Error('Could not load Plaid Link. Check your connection.'));};document.head.append(s);});}
async function connect(itemId,oauthReturn=false){
 if(!status.configured){notice(`Configure ${activeEnv} Plaid credentials in Plaid settings before connecting an account.`);$('plaid-settings').scrollIntoView({behavior:'smooth'});return;}
 const buttons=[$('connect-top'),$('connect-bottom')];buttons.forEach(b=>b.disabled=true);
 try{
  await loadLink();let token=oauthReturn?sessionStorage.getItem('plaid-link-token'):(await api('/api/link-token',itemId?{itemId}:{})).link_token;
  if(!token)throw Error('OAuth session expired. Start the connection again.');
  if(!oauthReturn){sessionStorage.setItem('plaid-link-token',token);sessionStorage.setItem('plaid-update-item',itemId||'');sessionStorage.setItem('plaid-environment',activeEnv);}
  const reconnect=itemId||sessionStorage.getItem('plaid-update-item');
  const handler=window.Plaid.create({token,...(oauthReturn?{receivedRedirectUri:window.location.href}:{}),onSuccess:async(public_token,metadata)=>{
    try{if(!reconnect){const result=await api('/api/exchange',{public_token,institution:metadata.institution?.name});notice(result.warning || 'Account linked. If transactions are still loading, use Sync accounts shortly.');}else notice('Connection restored. Use Sync accounts to retrieve updated data.');
      sessionStorage.removeItem('plaid-link-token');sessionStorage.removeItem('plaid-update-item');history.replaceState({},'', '/');mode='live';await load();
    }catch(e){notice(e.message);}finally{handler.destroy();}},onExit:error=>{if(error)notice(error.display_message || error.error_code);handler.destroy();}});handler.open();
 }catch(e){notice(e.message);}finally{buttons.forEach(b=>b.disabled=false);}
}
$('connect-top').onclick=()=>connect();$('connect-bottom').onclick=()=>connect();
$('sync').onclick=async()=>{if(mode==='demo'){notice('Sample data does not need syncing. Switch to connected accounts to sync Plaid data.');return;}$('sync').disabled=true;notice('Syncing connected accounts…');try{const r=await api('/api/sync',{});const failures=r.results.filter(x=>!x.ok);notice(!r.results.length?'No accounts connected yet.':failures.length?failures.map(x=>`${x.institution}: ${x.error}. Use Reconnect if login is required.`).join(' '):'Local data updated from Plaid. Bank data may lag; this does not force a bank refresh.');await load();}catch(e){notice(e.message);}finally{$('sync').disabled=false;}};
$('mode-toggle').onclick=async()=>{mode=mode==='demo'?'live':'demo';category='';limit=30;try{await load();}catch(e){notice(e.message);}};
$('period-month').onclick=()=>setPeriod(months.at(-1));$('period-last').onclick=()=>setPeriod(months.at(-2));$('period-six').onclick=()=>setPeriod('six');$('institution').onchange=()=>{category='';limit=30;render();};$('clear-category').onclick=()=>{category='';render();};$('search').oninput=()=>{limit=30;renderTransactions();};$('show-more').onclick=()=>{limit+=50;renderTransactions();};$('reduction').oninput=renderForecast;
for(const a of document.querySelectorAll('nav a'))a.onclick=()=>{document.querySelector('nav .active')?.classList.remove('active');a.classList.add('active');};
for(const environment of ['sandbox','production']){$(`env-${environment}`).onclick=()=>setEnvironment(environment);$(`config-${environment}`).onclick=()=>setEnvironment(environment);}
try{if(new URLSearchParams(location.search).has('oauth_state_id'))activeEnv=sessionStorage.getItem('plaid-environment')||activeEnv;status=await api(environmentPath('/api/status'));$('account-email').textContent=status.email;mode=status.connections?'live':'demo';await loadPlaidSettings();await load();if(new URLSearchParams(location.search).has('oauth_state_id'))await connect(undefined,true);}catch(e){notice(`Could not load dashboard: ${e.message}`);}

$('plaid-config-form').onsubmit=async e=>{
 e.preventDefault();const form=e.currentTarget,button=form.querySelector('button[type="submit"]'),message=$('plaid-config-message');message.hidden=false;button.disabled=true;message.textContent=`Saving ${activeEnv} credentials securely…`;
 try{await api('/api/plaid-config',{clientId:form.clientId.value,secret:form.secret.value});form.reset();await loadPlaidSettings();status=await api(environmentPath('/api/status'));message.textContent=`${activeEnv[0].toUpperCase()+activeEnv.slice(1)} is configured. You can connect an account now.`;}catch(e){message.textContent=e.message;}finally{button.disabled=false;}
};

$('sign-out').onclick=async()=>{try{await api('/api/auth/sign-out',{});location.replace('/login');}catch(e){notice(e.message);}};
$('password-form').onsubmit=async e=>{
 e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),message=$('password-message');message.hidden=false;
 if(form.newPassword.value!==form.confirmPassword.value){message.textContent='The new passwords do not match.';return;}
 if(form.newPassword.value===form.currentPassword.value){message.textContent='Choose a different password.';return;}
 button.disabled=true;message.textContent='Updating your password…';
 try{await api('/api/auth/change-password',{currentPassword:form.currentPassword.value,newPassword:form.newPassword.value,revokeOtherSessions:true});form.reset();status=await api('/api/status');message.textContent='Password updated. Your other sessions have been signed out.';}catch(e){message.textContent=e.message;}finally{button.disabled=false;}
};
