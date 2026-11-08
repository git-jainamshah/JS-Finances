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
const signal=loan=>{const platform=words(loan.platform);return platform.length?{words:platform,strong:true}:{words:[...new Set([...words(loan.who),...words(loan.name)])],strong:false};};
function nameScore(loan,name){
 const sig=signal(loan),tx=words(name),hits=sig.words.filter(w=>tx.some(t=>near(w,t)));
 if(!hits.length)return {score:0,hits,strong:sig.strong};
 return {score:sig.strong?1:Math.min(.7,.4+.15*hits.length),hits,strong:sig.strong};
}
// Transactions that could be a payment for this loan: money out for loans you owe, money in for loans you're owed.
const eligible=(loan,t)=>!t.pending&&(!t.currency||t.currency==='CAD')&&t.kind!=='credit_payment'&&(loan.dir==='owed'?t.amount<0:t.amount>0);
const addMonths=(isoDate,n)=>{const d=new Date(`${isoDate.slice(0,7)}-15T12:00:00`);d.setMonth(d.getMonth()+n);return d.toISOString().slice(0,7);};

export function scorePayment(loan,t){
 const amt=Math.abs(t.amount),pay=+loan.payment||0,n=nameScore(loan,t.name),reasons=[];
 let amount=0;if(pay>0){const r=Math.abs(amt-pay)/pay;amount=r<=.02?1:r<=.1?.75:r<=.25?.35:r<=.4?.15:0;}
 let day=0;if(pay>0&&loan.day){const g=dayGap(Number(t.date.slice(8)),+loan.day);day=g<=3?1:g<=7?.5:0;}
 if(n.score)reasons.push(`${n.strong?'matches the name on bank statements':'name matches'} “${n.hits.map(w=>w[0]+w.slice(1).toLowerCase()).join(', ')}”`);
 if(amount>=.75)reasons.push(amount===1?'same amount as your payment':'close to your payment amount');
 if(day===1)reasons.push(`around the ${ord(+loan.day)} of the month`);
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
