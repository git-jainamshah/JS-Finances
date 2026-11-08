// Loans, repay-someday plans and savings goals. Shared by the dashboard (browser) and Chat (server).
// Balances entered by hand are a starting point; confirmed matching transactions and recorded
// payments after that date reduce them. Nothing is linked without the owner confirming it.
import {merchantKey} from './insights.mjs';

const STOP=new Set(['LOAN','LOANS','PAYMENT','PAYMENTS','PMT','THE','AND','FOR','FROM','WITH','INC','LTD','CORP','CANADA','BANK','FINANCIAL','SERVICES','SERVICE','CREDIT','HELP','MONEY','MONTHLY','BILL','MY','OUR','TRIP','DEBT']);
const words=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9 ]+/g,' ').split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w)&&!/^\d+$/.test(w));
const ord=n=>n+(n%10===1&&n!==11?'st':n%10===2&&n!==12?'nd':n%10===3&&n!==13?'rd':'th');
const dayGap=(a,b)=>{const d=Math.abs(a-b);return Math.min(d,31-d);};
// Target dates are months ("by Nov 2027"), so count whole calendar months to reach them.
const monthsBetween=(fromIso,toIso)=>(+toIso.slice(0,4)-+fromIso.slice(0,4))*12+(+toIso.slice(5,7)-+fromIso.slice(5,7));
const isoToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

// A word "matches" a transaction word when equal, one starts with the other (4+ letters), or they differ by one letter.
function near(a,b){
 if(a===b)return true;
 if(a.length>=4&&b.length>=4&&(a.startsWith(b)||b.startsWith(a)))return true;
 if(Math.abs(a.length-b.length)>1||Math.min(a.length,b.length)<5)return false;
 let i=0,j=0,edits=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}
 return edits+(a.length-i)+(b.length-j)<=1;
}
// Name signal, in priority order: "Name on bank statements" (platform) is the source of truth when given.
// The loan title and "who lent it" are often just for the owner's reference (e.g. "Mexico trip" via
// Air Canada, actually financed by Upgrade), so they're only a weak fallback when no platform is set.
// An example transaction the owner picked ("this is one of my payments") adds its description words,
// amount and day as strong signals. It is only an example: matches still come from the search below.
const signal=loan=>{const strong=[...new Set([...words(loan.platform),...words(loan.example?.name)])];return strong.length?{words:strong,strong:true}:{words:[...new Set([...words(loan.who),...words(loan.name)])],strong:false};};
function nameScore(loan,name){
 const sig=signal(loan),tx=words(name),hits=sig.words.filter(w=>tx.some(t=>near(w,t)));
 if(!hits.length)return {score:0,hits,strong:sig.strong};
 return {score:sig.strong?1:Math.min(.7,.4+.15*hits.length),hits,strong:sig.strong};
}
// Transactions that could be a payment for this loan: money out for loans you owe, money in for loans you're owed.
// Lenders like Upgrade or Affirm are often labelled "card payment" by the bank, so card payments and
// transfers qualify when their description carries the loan's name signal.
const eligible=(loan,t)=>!t.pending&&(!t.currency||t.currency==='CAD')&&(loan.dir==='owed'?t.amount<0:t.amount>0)&&(!['credit_payment','transfer'].includes(t.kind)||nameScore(loan,t.name).score>0);
const addMonths=(isoDate,n)=>{const d=new Date(`${isoDate.slice(0,7)}-15T12:00:00`);d.setMonth(d.getMonth()+n);return d.toISOString().slice(0,7);};

const amountScore=(amt,pay)=>{if(!(pay>0))return 0;const r=Math.abs(amt-pay)/pay;return r<=.02?1:r<=.1?.75:r<=.25?.35:r<=.4?.15:0;};
const dayScore=(d,ref)=>{if(!ref)return 0;const g=dayGap(d,ref);return g<=3?1:g<=7?.5:0;};
export function scorePayment(loan,t){
 const amt=Math.abs(t.amount),pay=+loan.payment||0,ex=loan.example,n=nameScore(loan,t.name),reasons=[],d=Number(t.date.slice(8));
 const amount=Math.max(amountScore(amt,pay),ex?amountScore(amt,Math.abs(+ex.amount)):0);
 const day=Math.max(pay>0?dayScore(d,+loan.day):0,ex?.date?dayScore(d,Number(ex.date.slice(8))):0);
 if(n.score)reasons.push(`${n.strong?'matches the name on bank statements':'name matches'} “${n.hits.map(w=>w[0]+w.slice(1).toLowerCase()).join(', ')}”`);
 if(amount>=.75)reasons.push(amount===1?'same amount as your payment':'close to your payment amount');
 if(ex&&t.id===ex.id)reasons.push('your example');
 if(day===1)reasons.push(loan.day&&dayScore(d,+loan.day)===1?`around the ${ord(+loan.day)} of the month`:'same time of month as your example');
 // Priority: name on statements, then the monthly amount, then the day.
 return {score:n.score*.5+amount*.38+day*.12,name:n.score,strong:n.strong,amount,day,reasons};
}

// Every plausible group of payments, best first. Transactions are read newest first and the last
// 12 months decide the ranking; older history only adds weaker "other records" candidates.
// tier 1 = likely (shown first), tier 2 = other records (shown on "Check other records").
export function suggestMatches(loan,transactions,{taken=new Set(),today=isoToday()}={}){
 const linked=new Set(loan.matchKeys||[]),dismissed=new Set(loan.dismissedKeys||[]),groups=new Map(),recentFrom=addMonths(today,-12),staleFrom=addMonths(today,-3);
 const rows=transactions.filter(t=>eligible(loan,t)&&!taken.has(t.id)).sort((a,b)=>b.date.localeCompare(a.date));
 for(const t of rows){
  const key=merchantKey(t.name);if(!key||linked.has(key)||dismissed.has(key))continue;
  if(loan.matchPlatform&&signal(loan).strong&&nameScore(loan,t.name).score)continue;
  const s=scorePayment(loan,t);if(s.score<.15)continue;
  // Different descriptions from the same lender ("UPGRADE INC 8812", "PAD UPGRADE") form one group.
  const gk=s.strong&&s.name?'platform':key;
  const g=groups.get(gk)||{id:gk,keys:new Set(),name:t.name,rows:[],scores:[],reasons:new Set()};g.keys.add(key);g.rows.push(t);g.scores.push(s);s.reasons.forEach(r=>g.reasons.add(r));groups.set(gk,g);
 }
 const out=[];
 for(const g of groups.values()){
  const recent=g.rows.map((r,i)=>[r,g.scores[i]]).filter(([r])=>r.date.slice(0,7)>recentFrom),use=recent.length?recent:g.rows.map((r,i)=>[r,g.scores[i]]);
  const months=new Set(use.map(([r])=>r.date.slice(0,7))).size,allMonths=new Set(g.rows.map(r=>r.date.slice(0,7))).size;
  const avg=use.reduce((a,[,s])=>a+s.score,0)/use.length,named=g.scores.some(s=>s.name>0),exact=use.every(([,s])=>s.amount===1&&s.day>=.5);
  const stale=g.rows[0].date.slice(0,7)<staleFrom;
  const score=Math.max(0,Math.min(1,avg+(months>=3?.15:months>=2?.08:0)-(stale?.15:0)-(recent.length?0:.1)));
  let tier=0;
  if(score>=.55&&(named||(exact&&months>=3)))tier=1;
  else if(score>=.3&&(named||g.scores.some(s=>s.amount>=.75)))tier=2;
  if(!tier)continue;
  const reasons=[...g.reasons];if(months>=2)reasons.push(`${months} of the last 12 months`);if(stale)reasons.push(`last seen ${g.rows[0].date.slice(0,7)}`);
  const amounts=g.rows.map(r=>Math.abs(r.amount)).sort((a,b)=>a-b);
  out.push({key:g.id,keys:[...g.keys],platform:g.id==='platform',name:g.name,count:g.rows.length,months:allMonths,recentMonths:months,total:Math.round(amounts.reduce((a,b)=>a+b,0)*100)/100,typical:amounts[Math.floor(amounts.length/2)],first:g.rows.at(-1).date,last:g.rows[0].date,score,tier,confidence:tier===2?'Low':score>=.75?'High':'Medium',reasons,txIds:g.rows.map(r=>r.id)});
 }
 return out.sort((a,b)=>a.tier-b.tier||b.score-a.score||b.last.localeCompare(a.last));
}

// Confirmed payments: transactions from linked descriptions (or, once the lender is linked, any description
// carrying the name on bank statements) (within a sensible amount) minus ones you unlinked.
export function linkedPayments(loan,transactions){
 const keys=new Set(loan.matchKeys||[]),rejected=new Set(loan.rejectedTx||[]),pay=+loan.payment||0,byName=loan.matchPlatform&&signal(loan).strong;
 if(!keys.size&&!byName)return [];
 return transactions.filter(t=>eligible(loan,t)&&(keys.has(merchantKey(t.name))||(byName&&nameScore(loan,t.name).score>0))&&!rejected.has(t.id)&&(!pay||Math.abs(Math.abs(t.amount)-pay)/pay<=.5)).map(t=>({id:`tx:${t.id}`,txId:t.id,date:t.date,amount:Math.round(Math.abs(t.amount)*100)/100,source:'bank',name:t.name}));
}

// Current state of a loan or plan: balance after payments since the balance was entered.
export function loanState(loan,transactions=[],today=isoToday()){
 const asOf=loan.balanceAsOf||'0000-00-00',manual=(loan.payments||[]).map(p=>({...p,source:'manual'})),bank=loan.connected?[]:linkedPayments(loan,transactions);
 const history=[...manual,...bank].sort((a,b)=>b.date.localeCompare(a.date)).map(p=>({...p,counted:p.date>asOf||(p.source==='manual'&&p.date>=asOf)}));
 const paidSince=history.filter(p=>p.counted).reduce((s,p)=>s+p.amount,0);
 const balance=Math.max(0,Math.round(((+loan.balance||0)-paidSince)*100)/100),original=Math.max(+loan.original||0,+loan.balance||0,balance);
 const months=loan.targetDate?Math.max(1,monthsBetween(today,loan.targetDate)):null;
 return {balance,original,paidSince,history,pct:original?Math.max(0,Math.min(100,(1-balance/original)*100)):0,monthsLeft:months,monthlyToTarget:months&&balance>0?Math.ceil(balance/months):0,lastPayment:history[0]||null};
}

// Savings goals: progress and the monthly amount needed to reach the target on time.
export function goalState(goal,today=isoToday()){
 const saved=Math.round(((+goal.saved||0)+(goal.contributions||[]).reduce((s,c)=>s+(+c.amount||0),0))*100)/100,target=+goal.target||0,left=Math.max(0,target-saved);
 const months=goal.targetDate?Math.max(1,monthsBetween(today,goal.targetDate)):null;
 return {saved,target,left,pct:target?Math.min(100,saved/target*100):0,monthsLeft:months,monthly:months&&left>0?Math.ceil(left/months):0,done:target>0&&left===0};
}

// Everything that needs money set aside each month, for Projections and Chat.
export function planSummary(loans=[],goals=[],transactions=[],today=isoToday()){
 const someday=loans.filter(l=>l.kind==='someday'&&l.dir==='owe').map(l=>({l,s:loanState(l,transactions,today)}));
 const goalViews=goals.map(g=>({g,s:goalState(g,today)}));
 const items=[...someday.filter(x=>x.s.balance>0).map(x=>({type:'repay',id:x.l.id,name:x.l.name,who:x.l.who,left:x.s.balance,monthly:x.s.monthlyToTarget,targetDate:x.l.targetDate||null})),...goalViews.filter(x=>!x.s.done).map(x=>({type:'goal',id:x.g.id,name:x.g.name,left:x.s.left,monthly:x.s.monthly,targetDate:x.g.targetDate||null}))];
 return {items,monthly:items.reduce((s,i)=>s+i.monthly,0),someday,goals:goalViews};
}

export const describeForChat=(loans=[],goals=[],transactions=[])=>{
 const ls=loans.map(l=>{const s=loanState(l,transactions);return `${l.kind==='someday'?'Plans to repay someday':l.dir==='owe'?'User owes':'Owed to user by'} ${l.who||'someone'}: "${l.name}" balance ${s.balance} of ${s.original}${l.kind==='someday'?(l.targetDate?`, target date ${l.targetDate} (~${s.monthlyToTarget}/mo)`:', no target date'):`, monthly ${+l.payment||0}, rate ${l.rate??'unknown'}%`}${l.gentle?', lender is not expecting repayment':''}${s.history.length?`, ${s.history.length} payments tracked, last ${s.lastPayment.date}`:''}`;});
 const gs=goals.map(g=>{const s=goalState(g);return `"${g.name}": saved ${s.saved} of ${s.target}${g.targetDate?` by ${g.targetDate} (needs ~${s.monthly}/mo)`:''}`;});
 return {loans:ls.join('; ')||'none',goals:gs.join('; ')||'none'};
};

// Transaction ids confirmed as payments on loans you added. Banks often file these as card payments or
// transfers (which don't count as spending); the dashboard counts them as "Loan payments" instead.
export function loanPaymentIds(loans=[],transactions=[]){
 const ids=new Set();
 for(const l of loans){if(l.connected||l.dir!=='owe')continue;for(const p of linkedPayments(l,transactions))ids.add(p.txId);}
 return ids;
}

// ---------- Lines of credit ----------
const amortize=(balance,ratePct,months)=>{const i=ratePct/1200;return i?balance*i/(1-Math.pow(1+i,-months)):balance/months;};
const isInterest=t=>/INTEREST|INT CHG|INT\.? CHARGE/i.test(t.name)||t.category==='Bank fees'&&/INT/i.test(t.name);
// Draws, payments and interest on a line of credit over the last 6 complete months, from its own transactions.
export function locState(account,transactions=[],today=isoToday(),rate=null){
 const months=[];for(let i=6;i>=1;i--)months.push(addMonths(today,-i));
 const rows=transactions.filter(t=>t.accountId===account.id&&!t.pending);
 const by=months.map(m=>{const r=rows.filter(t=>t.date.startsWith(m));return {month:m,paid:r.filter(t=>t.amount<0).reduce((s,t)=>s-t.amount,0),drawn:r.filter(t=>t.amount>0&&!isInterest(t)).reduce((s,t)=>s+t.amount,0),interest:r.filter(t=>t.amount>0&&isInterest(t)).reduce((s,t)=>s+t.amount,0)};});
 const active=by.filter(m=>m.paid||m.drawn||m.interest),n=Math.max(1,active.length),avg=k=>Math.round(active.reduce((s,m)=>s+m[k],0)/n*100)/100;
 const balance=Math.max(0,Math.round(Math.abs(+account.balance||0)*100)/100),limit=+account.limit||0,paid=avg('paid'),drawn=avg('drawn'),interest=avg('interest');
 const estRate=interest&&balance?Math.round(interest*12/balance*1000)/10:null,useRate=rate??estRate??9.95,net=Math.round((paid-drawn-interest)*100)/100;
 return {id:account.id,name:account.name,institution:account.institution,balance,limit,util:limit?balance/limit*100:null,months:by,hasActivity:active.length>0,paid,drawn,interest,net,estRate,rate:useRate,rateSource:rate!=null?'you':estRate!=null?'estimated from interest charges':'assumed',
  monthsAtPace:net>0&&balance>0?Math.ceil(balance/net):null,interestMonthly:Math.round(balance*useRate/1200*100)/100,
  payFor:[12,24,36].map(m=>({months:m,payment:Math.ceil(amortize(balance,useRate,m))}))};
}

// ---------- Debt & stability plan ----------
// Pay every minimum, then send all extra money to the highest-rate debt (avalanche); freed payments roll over.
export function simulatePayoff(debts,extra=0,maxMonths=600){
 let list=debts.filter(d=>d.balance>0).map(d=>({...d,bal:d.balance,paidOff:null})),interest=0,m=0;
 if(!list.length)return {months:0,interest:0,order:[]};
 const budget=list.reduce((s,d)=>s+d.min,0)+extra;
 while(list.some(d=>d.bal>.005)&&m<maxMonths){
  m++;let pool=budget;
  for(const d of list)if(d.bal>0){const i=d.bal*d.rate/1200;interest+=i;d.bal+=i;}
  for(const d of list)if(d.bal>0){const p=Math.min(d.bal,d.min,pool);d.bal-=p;pool-=p;}
  for(const d of [...list].sort((a,b)=>b.rate-a.rate))if(d.bal>0&&pool>0){const p=Math.min(d.bal,pool);d.bal-=p;pool-=p;}
  for(const d of list)if(d.bal<=.005&&d.paidOff==null){d.bal=0;d.paidOff=m;}
  if(m===1&&list.every(d=>d.bal>=d.balance))return {months:null,interest:null,order:[]};
 }
 return {months:list.some(d=>d.bal>.005)?null:m,interest:Math.round(interest),order:list.filter(d=>d.paidOff).sort((a,b)=>a.paidOff-b.paidOff).map(d=>({name:d.name,month:d.paidOff}))};
}

const CARD_RATE=20.99,$=n=>'$'+Math.round(n).toLocaleString('en-CA');
// One picture of income, spending, debts and plans, with ranked suggestions. All inputs come from the
// dashboard (engine plan, accounts, loans, goals); rates you don't know are labelled as assumed.
export function debtPlan({plan,accounts=[],transactions=[],loans=[],goals=[],cash=0,rates={},today=isoToday()}){
 const income=plan.income,spending=plan.outBase,kept=plan.keptBase,debts=[];
 for(const a of accounts){
  const bal=Math.abs(+a.balance||0);if(!bal)continue;
  if(a.class==='credit_card'){const rate=rates[a.id]??CARD_RATE;debts.push({id:a.id,type:'card',name:`${a.institution} ${a.name}`,balance:bal,limit:+a.limit||0,rate,rateSource:rates[a.id]!=null?'you':'assumed',min:Math.max(10,Math.ceil(bal*.03))});}
  if(a.class==='loan'){const c=loans.find(l=>l.id===`acct-${a.id}`),rate=rates[a.id]??(c?.rate!=null?+c.rate:null);debts.push({id:a.id,type:'loan',name:`${a.institution} ${a.name}`,balance:bal,limit:0,rate:rate??0,rateSource:rate!=null?'you':'unknown',min:Math.min(bal,+c?.payment||Math.ceil(bal*.03))});}
  if(a.class==='credit_line'){const l=locState(a,transactions,today,rates[a.id]);debts.push({id:a.id,type:'loc',name:`${a.institution} ${a.name}`,balance:bal,limit:l.limit,rate:l.rate,rateSource:l.rateSource,min:Math.max(l.interestMonthly+10,l.paid>0?Math.min(l.paid,bal):0),loc:l});}
 }
 // Bank-connected loans come from the accounts above; these are the ones you added.
 for(const l of loans){
  if(l.dir!=='owe'||l.kind==='someday'||l.connected)continue;const st=loanState(l,transactions,today);if(!(st.balance>0))continue;
  debts.push({id:l.id,type:'loan',name:l.name,balance:st.balance,limit:0,rate:+l.rate||0,rateSource:l.rate==null?'assumed':'you',min:Math.min(st.balance,+l.payment||Math.ceil(st.balance*.03))});
 }
 const total=debts.reduce((s,d)=>s+d.balance,0),minimums=debts.reduce((s,d)=>s+d.min,0),interestMonthly=debts.reduce((s,d)=>s+d.balance*d.rate/1200,0);
 const cards=debts.filter(d=>d.type!=='loan'&&d.limit),used=cards.reduce((s,d)=>s+d.balance,0),limit=cards.reduce((s,d)=>s+d.limit,0),util=limit?used/limit*100:null;
 const plans=planSummary(loans,goals,transactions,today),bufferMonths=spending>0?cash/spending:null;
 const steps=[];
 if(kept<0){
  const gap=-kept,flex=plan.groups.filter(g=>g.flexible&&g.base>0).sort((a,b)=>b.base-a.base);let left=gap;const cuts=[];
  // Trim the biggest flexible categories by up to 25% each, then up to 40% if that isn't enough.
  const cut={};for(const pct of [.25,.4])for(const g of flex){if(left<=0)break;const add=Math.min(left,Math.round(g.base*pct)-(cut[g.name]||0));if(add>0){cut[g.name]=(cut[g.name]||0)+add;left-=add;}}
  for(const g of flex)if(cut[g.name]>=10)cuts.push({name:g.name,amount:cut[g.name],from:Math.round(g.base)});
  steps.push({id:'gap',level:'urgent',title:`Stop the monthly shortfall of ${$(gap)}`,body:'You spend more than you bring in, so the gap is being covered by cards, your line of credit or savings. Fix this first, because every other step depends on it.',cuts,subs:(plan.subs||[]).slice().sort((a,b)=>b.amount-a.amount).slice(0,5)});
 }
 const top=[...debts].sort((a,b)=>b.rate-a.rate)[0];
 if(top&&top.rate>=8)steps.push({id:'avalanche',level:'high',title:`Put any extra money on ${top.name} first (${top.rate}% interest)`,body:`Keep paying the minimum on everything, then send every extra dollar to the highest-rate debt. Your debts cost about ${$(interestMonthly)} a month in interest right now.`,order:[...debts].sort((a,b)=>b.rate-a.rate).map(d=>({id:d.id,type:d.type,name:d.name,rate:d.rate,rateSource:d.rateSource,balance:d.balance}))});
 if(util!=null&&util>30)steps.push({id:'util',level:'medium',title:`Bring card and credit-line use under 30%`,body:`You're using ${Math.round(util)}% of your available credit. Paying down ${$(used-limit*.3)} gets you under 30%, which helps your credit score and lowers interest.`});
 const locs=debts.filter(d=>d.type==='loc');
 for(const d of locs){const l=d.loc;if(l.drawn>l.paid*.5&&l.drawn>50)steps.push({id:'loc-'+d.id,level:'high',title:`Stop drawing on ${d.name}`,body:`On average you draw ${$(l.drawn)} and pay back ${$(l.paid)} a month, so the balance ${l.net>0?'barely moves':'keeps growing'}. Treat it as closed for new spending.`});}
 if(bufferMonths!=null&&cash<Math.min(1000,spending))steps.push({id:'buffer',level:'medium',title:'Build a small buffer of $1,000',body:'With little cash on hand, any surprise bill goes on credit. Even a small buffer breaks that cycle. Build it after the shortfall is fixed and before extra debt payments.'});
 if(plans.monthly>0&&(kept<0||plans.monthly>kept))steps.push({id:'goals',level:'low',title:'Your goals need more than you currently keep',body:`Goals and repayment plans need about ${$(plans.monthly)} a month, but you keep ${$(Math.max(0,kept))}. Move target dates later, or start them once your high-interest debt is paid off.`});
 const rank={urgent:0,high:1,medium:2,low:3};steps.sort((a,b)=>rank[a.level]-rank[b.level]);
 const status=kept<0?'overspending':interestMonthly>Math.max(50,income*.05)?'debt-heavy':util!=null&&util>50?'stretched':'stable';
 return {income,spending,kept,debts,total,minimums,interestMonthly,util,dti:income>0?minimums/income*100:null,cash,bufferMonths,plans,steps,status,
  scenarios:[0,100,250,500].map(extra=>({extra,...simulatePayoff(debts,extra)}))};
}

export const describeDebtForChat=p=>`Monthly income ~${Math.round(p.income)}, spending ~${Math.round(p.spending)}, kept ${Math.round(p.kept)}. Debts total ${Math.round(p.total)}: ${p.debts.map(d=>`${d.name} (${d.type}) ${Math.round(d.balance)} at ${d.rate}% (${d.rateSource})${d.loc?`, LOC avg paid ${Math.round(d.loc.paid)}/mo drawn ${Math.round(d.loc.drawn)}/mo`:''}`).join('; ')||'none'}. Minimum payments ~${Math.round(p.minimums)}/mo, interest ~${Math.round(p.interestMonthly)}/mo, credit use ${p.util==null?'n/a':Math.round(p.util)+'%'}. Cash ${Math.round(p.cash)}. Status: ${p.status}.`;
