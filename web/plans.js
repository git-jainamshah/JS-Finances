// Loans & IOUs page: scheduled loans, money lent, repay-someday plans and savings goals,
// plus the shared summaries used by Overview, Projections and Recurring.
import {html} from '/vendor/preact-htm.mjs';
import {loanState,goalState,suggestMatches,linkedPayments,planSummary} from '/loans.mjs';
import {Select,Switch,title} from '/ui.js';
import {H2,Sub,card,Kpis,MoneyInput,inputSt,fieldLabel} from '/pages.js';

const ord=n=>n+(n%10===1&&n!==11?'st':n%10===2&&n!==12?'nd':n%10===3&&n!==13?'rd':'th');
const monthLabel=d=>d?new Date(`${d.slice(0,7)}-15T12:00:00`).toLocaleDateString('en-CA',{month:'short',year:'numeric'}):'';
const pill='display:inline-flex;align-items:center;gap:8px;border:1px solid #dfe5db;background:#fff;border-radius:999px;font-size:13px;font-weight:600;color:#183c35;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s,border-color .15s;flex:none;padding:7px 14px';
const btn='background:#fff;border:1px solid #cdd6ca;padding:9px 14px;border-radius:10px;font-size:14px;font-weight:600;color:#183c35;cursor:pointer;min-height:42px';
const btnDark='background:#183c35;border:1px solid #183c35;padding:9px 16px;border-radius:10px;font-size:14px;font-weight:600;color:#fff;cursor:pointer;min-height:42px';
const empty=t=>html`<p style="margin:0;padding:16px;background:#f7f9f4;border-radius:10px;font-size:14px;color:#3d4d45">${t}</p>`;
const todayIso=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

// ---------- shared summaries ----------
export function loanView(A,J,l){
 const st=loanState(l,J.tx,J.todayIso),someday=l.kind==='someday',m=J.loanMath({...l,balance:st.balance}),end=!someday&&m.months!=null?new Date(J.TODAY.getFullYear(),J.TODAY.getMonth()+m.months,1):null;
 return {l,st,someday,owe:l.dir==='owe',balance:st.balance,pct:st.pct,m,end,endLabel:st.balance<=0?'Done':someday?(l.targetDate?monthLabel(l.targetDate):'No date'):end?end.toLocaleDateString('en-CA',{month:'short',year:'numeric'}):'—'};
}
export function loanSummary(A,J){
 const views=A.allLoans(J).map(l=>loanView(A,J,l)),sched=views.filter(v=>!v.someday),owe=sched.filter(v=>v.owe),owed=sched.filter(v=>!v.owe),someday=views.filter(v=>v.someday);
 const sum=a=>a.reduce((s,v)=>s+v.balance,0),pay=a=>a.filter(v=>v.balance>0).reduce((s,v)=>s+(+v.l.payment||0),0);
 const goals=(A.state.goals||[]).map(g=>({g,st:goalState(g,J.todayIso)})),plans=planSummary(A.state.loans,A.state.goals||[],J.tx,J.todayIso);
 return {views,owe:sum(owe),owed:sum(owed),someday:sum(someday),monthly:pay(owe),owedMonthly:pay(owed),oweN:owe.length,owedN:owed.length,somedayN:someday.length,
  debtEnd:owe.filter(v=>v.end&&v.balance>0).sort((a,b)=>b.end-a.end)[0],goals,saved:goals.reduce((s,x)=>s+x.st.saved,0),goalTarget:goals.reduce((s,x)=>s+x.st.target,0),plans};
}

// ---------- state helpers ----------
const updLoan=(A,id,fn)=>A.setState(st=>({loans:st.loans.map(x=>x.id===id?fn(x):x)}));
const updGoal=(A,id,fn)=>A.setState(st=>({goals:(st.goals||[]).map(x=>x.id===id?fn(x):x)}));
const typeOf=x=>x.target!=null&&x.balance==null?'goal':x.kind==='someday'?'someday':x.dir==='owed'?'owed':'owe';
const formFrom=x=>{const t=typeOf(x);return t==='goal'?{type:t,id:x.id,name:x.name,target:String(x.target??''),saved:String(x.saved??''),targetDate:(x.targetDate||'').slice(0,7)}:{type:t,id:x.id,name:x.name||'',who:x.who||'',platform:x.platform||'',balance:String(x.balance??''),original:String(x.original??''),payment:String(x.payment||''),rate:x.rate==null?'':String(x.rate),day:x.day||1,targetDate:(x.targetDate||'').slice(0,7),gentle:!!x.gentle,rematch:'keep',rematchSet:false};};
const blankForm=type=>type==='goal'?{type,name:'',target:'',saved:'',targetDate:''}:{type,name:'',who:'',platform:'',balance:'',original:'',payment:'',rate:'',day:1,targetDate:'',gentle:false};

function saveForm(A,e){
 e.preventDefault();const S=A.state,v=S.loanForm,name=v.name.trim().slice(0,120),today=todayIso(),err=m=>A.setState({loanErr:m});
 if(!name)return err('Give it a name so you can recognise it later.');
 const month=v.targetDate?`${v.targetDate}-01`:'';
 if(v.type==='goal'){
  const target=+v.target;if(!(target>0))return err('Enter how much you want to save.');
  const old=(S.goals||[]).find(g=>g.id===v.id),goal={...(old||{}),id:old?.id||'g'+Date.now(),name,target,saved:Math.max(0,+v.saved||0),targetDate:month,contributions:old?.contributions||[]};
  A.setState(st=>({goals:old?st.goals.map(g=>g.id===old.id?goal:g):[...(st.goals||[]),goal],loanForm:null,loanErr:''}));A.toast(old?`Updated ${name}`:`Added goal: ${name}`);return;
 }
 const balance=+v.balance;if(!(balance>0))return err(v.type==='someday'?'Enter the amount you’d like to repay.':'Enter how much is still owed.');
 if(month&&month<today)return err('Pick a date in the future.');
 const old=S.loans.find(l=>l.id===v.id),changed=!old||Math.abs((+old.balance||0)-balance)>.004,someday=v.type==='someday';
 const loan={...(old||{}),id:old?.id||'l'+Date.now(),dir:v.type==='owed'?'owed':'owe',kind:someday?'someday':'scheduled',name,who:(v.who.trim()||(v.type==='owed'?'Someone':'Lender')).slice(0,120),platform:(v.platform||'').trim().slice(0,80),
  original:Math.max(balance,+v.original||(old&&!changed?+old.original:0)||balance),balance,balanceAsOf:changed?today:(old.balanceAsOf||today),payment:someday?0:Math.max(0,+v.payment||0),rate:someday?0:(v.rate===''?0:Math.max(0,+v.rate)),day:+v.day||1,targetDate:someday?month:'',gentle:someday&&!!v.gentle,connected:false,payments:old?.payments||[]};
 if(old&&v.rematch==='new'){loan.matchKeys=[];loan.matchPlatform=false;loan.dismissedKeys=[];loan.rejectedTx=[];}
 A.setState(st=>({loans:old?st.loans.map(l=>l.id===old.id?loan:l):[...st.loans,loan],loanForm:null,loanErr:'',matchPage:{...st.matchPage,[loan.id]:0}}));
 A.toast(old?`Updated ${name}.${changed?' Balance counted from today.':''}${v.rematch==='new'?' Looking for matching payments again.':''}`:`Added ${name}`);
}

// ---------- form ----------
function LoanForm({A,S,pad}){
 // Changing what matching uses (name on statements, lender, amount, day) defaults to finding new matches.
 const MATCH_FIELDS=['platform','who','name','payment','day'];
 const fm=S.loanForm,setF=(k,val)=>A.setState(st=>({loanForm:{...st.loanForm,[k]:val,...(st.loanForm.id&&!st.loanForm.rematchSet&&MATCH_FIELDS.includes(k)?{rematch:'new'}:{})}})),editing=!!fm.id,t=fm.type;
 const types=[['owe','I’m paying back a loan','Bank, Upgrade, Affirm, student loan, family…'],['owed','I lent money','Someone is paying you back'],['someday','I’ll repay someday','No set payments yet, e.g. help from family'],['goal','Saving for something','Kids, a home, a big opportunity']];
 const dayOpts=[...Array(28)].map((_,i)=>({value:i+1,label:i===0?'1st of the month':ord(i+1)}));
 const opt=txt=>html`<span style="font-weight:400;color:#5a6b63">${txt}</span>`;
 const field=(label,input,hint)=>html`<label style=${fieldLabel}><span style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap">${label}</span>${input}${hint?html`<span style="font-weight:400;font-size:12px;color:#5a6b63">${hint}</span>`:null}</label>`;
 const text=(k,ph,max=120)=>html`<input value=${fm[k]} onInput=${e=>setF(k,e.target.value)} maxlength=${max} placeholder=${ph} class="fi" style=${inputSt}/>`;
 const money=(k,ph)=>html`<${MoneyInput} value=${fm[k]} onInput=${e=>setF(k,e.target.value)} placeholder=${ph||'0'}/>`;
 const monthInput=html`<input type="month" value=${fm.targetDate} onInput=${e=>setF('targetDate',e.target.value)} min=${todayIso().slice(0,7)} class="fi" style=${inputSt}/>`;
 const old=editing&&t!=='goal'?S.loans.find(l=>l.id===fm.id):null;
 return html`<form onSubmit=${e=>saveForm(A,e)} aria-label=${editing?'Edit':'Add'} style=${`background:#fff;border:1px solid #cdd6ca;border-radius:16px;padding:${pad};display:grid;gap:18px;box-shadow:0 14px 40px #183c3514;animation:jsfin .2s ease-out`}>
  <div><${H2}>${editing?`Edit ${fm.name||'item'}`:'Add a loan, IOU or goal'}</${H2}><${Sub}>${editing?'Fix anything that was entered wrong. Changing the balance counts it from today.':'For anything your banks can’t show on their own.'}</${Sub}></div>
  ${!editing?html`<div role="radiogroup" aria-label="Type" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:10px">${types.map(([id,label,note])=>{const a=t===id;return html`<button type="button" role="radio" aria-checked=${a} onClick=${()=>A.setState(st=>({loanForm:{...blankForm(id),name:st.loanForm.name}}))} class="hv-border2" style=${`display:flex;gap:12px;align-items:center;text-align:left;border:${a?'2px':'1px'} solid ${a?'#315e4e':'#e2e7df'};border-radius:12px;padding:12px;background:${a?'#f3f6ef':'#fff'};cursor:pointer;transition:border-color .15s`}><span aria-hidden="true" style=${`width:20px;height:20px;border-radius:50%;border:2px solid ${a?'#315e4e':'#9fb09a'};display:grid;place-items:center;flex:none`}><span style=${`width:9px;height:9px;border-radius:50%;background:${a?'#315e4e':'transparent'}`}></span></span><span><b style="display:block;font-size:14px">${label}</b><span style="font-size:12px;color:#5a6b63">${note}</span></span></button>`;})}</div>`:null}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:14px;align-items:start">
   ${t==='goal'?html`
    ${field('What are you saving for?',text('name','e.g. Future kids fund'))}
    ${field('Target amount',money('target'))}
    ${field(html`Already saved ${opt('optional')}`,money('saved'))}
    ${field(html`By when? ${opt('optional')}`,monthInput,'Used to work out how much to set aside each month.')}`
   :t==='someday'?html`
    ${field('What’s it for?',text('name','e.g. Help with condo down payment'))}
    ${field('Who is it from?',text('who','e.g. Mom & Dad'))}
    ${field('Amount you’d like to repay',money('balance'))}
    ${field(html`Repay by ${opt('optional')}`,monthInput,'Projections will show how much to set aside each month.')}
    <button type="button" role="switch" aria-checked=${!!fm.gentle} onClick=${()=>setF('gentle',!fm.gentle)} style="display:flex;align-items:center;gap:10px;border:0;background:none;padding:22px 0 0;font-size:14px;cursor:pointer;color:#183c35;text-align:left"><${Switch} on=${!!fm.gentle}/>They’re not expecting it back</button>`
   :html`
    ${field('What’s it for?',text('name',t==='owed'?'e.g. Concert tickets + trip':'e.g. Personal loan, car loan'))}
    ${field(t==='owed'?'Who borrowed it?':'Who lent it to you?',text('who',t==='owed'?'e.g. Arjun':'e.g. Upgrade, Affirm, OSAP, Mom & Dad'))}
    ${field(html`Name on bank statements ${opt('recommended')}`,text('platform',t==='owed'?'e.g. ARJUN P (e-transfer)':'e.g. UPGRADE INC',80),'Who actually takes the payment. Used first for matching; the fields above are just for you.')}
    ${field(t==='owed'?'Amount still to come back':'Amount still owed',money('balance'))}
    ${field(html`Original amount ${opt('optional')}`,money('original','Same as above'))}
    ${field(t==='owed'?html`Expected monthly ${opt('optional')}`:'Monthly payment',money('payment'))}
    ${t==='owe'?field(html`Interest rate ${opt('optional')}`,html`<span style="position:relative;display:flex;align-items:center"><input type="number" min="0" step="0.01" inputmode="decimal" value=${fm.rate} onInput=${e=>setF('rate',e.target.value)} placeholder="0" class="fi" style=${inputSt+';padding-right:30px'}/><span aria-hidden="true" style="position:absolute;right:12px;color:#5a6b63">%</span></span>`):null}
    <div style="display:grid;gap:6px"><${Select} value=${fm.day} options=${dayOpts} onChange=${val=>setF('day',val)} label="Payment day" width="100%" minWidth="0"/></div>`}
  </div>
  ${editing&&t!=='goal'&&old&&!old.connected?html`<fieldset style="border:1px solid #e2e7df;border-radius:12px;padding:12px 14px;margin:0;display:grid;gap:8px"><legend style="font-size:13px;font-weight:600;padding:0 6px">After saving</legend>${[['new','Find new matching transactions','Clears linked and hidden matches and searches again with these details. Payments you recorded yourself stay.'],['keep','Keep current, I just corrected something personal','Linked payments stay as they are.']].map(([id,label,note])=>html`<label style="display:flex;gap:10px;align-items:flex-start;font-size:14px;cursor:pointer"><input type="radio" name="rematch" checked=${fm.rematch===id} onChange=${()=>A.setState(st=>({loanForm:{...st.loanForm,rematch:id,rematchSet:true}}))} style="margin-top:3px;accent-color:#315e4e"/><span><b style="font-weight:600">${label}</b><span style="display:block;font-size:12px;color:#5a6b63">${note}</span></span></label>`)}</fieldset>`:null}
  ${old&&old.balanceAsOf?html`<p style="margin:0;font-size:12px;color:#5a6b63">Balance last entered ${new Date(`${old.balanceAsOf}T12:00:00`).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'})}. Payments after that date are subtracted automatically.</p>`:null}
  ${S.loanErr?html`<p role="alert" style="margin:0;font-size:14px;color:#9a3d2a;background:#fbefeb;border:1px solid #efcfc5;border-radius:10px;padding:10px 12px">${S.loanErr}</p>`:null}
  <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" onClick=${()=>A.setState({loanForm:null,loanErr:''})} style=${btn}>Cancel</button><button type="submit" style=${btnDark}>${editing?'Save changes':t==='goal'?'Add goal':'Add'}</button></div>
 </form>`;
}

// ---------- pieces of a card ----------
const PAGE=3;
function Matches({A,l,J,taken}){
 if(l.connected)return null;
 const all=suggestMatches(l,J.tx,{taken,today:J.todayIso}),linked=linkedPayments(l,J.tx),isLinked=(l.matchKeys||[]).length||l.matchPlatform;
 const page=A.state.matchPage[l.id]||0,firstTier=all.filter(s=>s.tier===1).length;
 // Page 0 shows the likely matches (up to 3); "Check other records" walks through the rest, 3 at a time.
 const start=page===0?0:Math.min(firstTier,PAGE)+(page-1)*PAGE,shown=page===0?all.filter(s=>s.tier===1).slice(0,PAGE):all.slice(start,start+PAGE),more=page===0?all.length>shown.length:start+PAGE<all.length;
 const setPage=n=>A.setState(st=>({matchPage:{...st.matchPage,[l.id]:n}}));
 if(!isLinked&&!all.length&&!(+l.payment>0||l.platform))return null;
 return html`<div style="display:grid;gap:8px">
  ${isLinked?html`<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#eef5e8;border-radius:10px;padding:9px 12px;font-size:13px;color:#2f5d3a"><span><b>Tracking payments automatically</b> · ${linked.length} found${linked[0]?`, latest ${A.fmtDate(linked[0].date)}`:''}</span><button onClick=${()=>{updLoan(A,l.id,x=>({...x,matchKeys:[],matchPlatform:false}));A.toast('Stopped tracking. Recorded payments stay.');}} style="border:0;background:none;color:#2f5d3a;font-size:13px;font-weight:600;cursor:pointer;text-decoration:underline">Stop</button></div>`:null}
  ${shown.map(s=>html`<div style=${`border:1px solid ${s.tier===1?'#d6e2ee':'#e2e7df'};background:${s.tier===1?'#f4f8fc':'#fafbf8'};border-radius:12px;padding:12px;display:grid;gap:8px`}>
   <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline"><b style="font-size:14px">${s.tier===1?`Looks like your ${l.dir==='owed'?'repayments':'payments'}`:'Could this be it?'}</b><span style=${`font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:${s.confidence==='High'?'#e6f0dc':s.confidence==='Medium'?'#fbefd9':'#eef1ea'};color:${s.confidence==='High'?'#2f5d3a':s.confidence==='Medium'?'#7a5520':'#3d4d45'}`}>${s.confidence} confidence</span></div>
   <div style="font-size:13px;color:#3d4d45"><b>${title(s.name)}</b>${s.keys.length>1?` + ${s.keys.length-1} similar description${s.keys.length>2?'s':''}`:''} · ${s.count} payment${s.count>1?'s':''} · usually ${A.money(s.typical,2)} · ${A.fmtDate(s.first)} to ${A.fmtDate(s.last)}</div>
   <div style="font-size:12px;color:#5a6b63">Why: ${s.reasons.join(' · ')||'similar amount'}</div>
   <div style="display:flex;gap:8px;flex-wrap:wrap"><button onClick=${()=>{updLoan(A,l.id,x=>({...x,matchKeys:[...new Set([...(x.matchKeys||[]),...s.keys])],matchPlatform:x.matchPlatform||s.platform}));setPage(0);A.toast(`Linked. Future “${title(s.name)}” payments will count automatically.`);}} class="hv-dark" style=${pill+';background:#183c35;color:#fff;border-color:#183c35'}>✓ Yes, link these</button><button onClick=${()=>updLoan(A,l.id,x=>({...x,dismissedKeys:[...new Set([...(x.dismissedKeys||[]),...s.keys])]}))} class="hv-quiet" style=${pill}>Not this</button></div>
  </div>`)}
  ${!shown.length&&!isLinked?html`<p style="margin:0;font-size:13px;color:#5a6b63;background:#f7f9f4;border-radius:10px;padding:9px 12px">${page?'No other matching records found.':'No likely payments found in the last 12 months.'} ${l.platform?'':'Adding the “Name on bank statements” (Edit) helps the most.'}</p>`:null}
  ${more||page?html`<div style="display:flex;gap:8px;flex-wrap:wrap">${more?html`<button onClick=${()=>setPage(page+1)} class="hv-pill" style=${pill}>Check other records</button>`:null}${page?html`<button onClick=${()=>setPage(0)} class="hv-quiet" style=${pill}>Back to best matches</button>`:null}</div>`:null}
 </div>`;
}
function History({A,l,st}){
 const open=A.state.histOpen===l.id;if(!st.history.length)return null;
 return html`<div style="display:grid;gap:6px"><button onClick=${()=>A.setState({histOpen:open?'':l.id})} aria-expanded=${open} style="justify-self:start;border:0;background:none;padding:0;font-size:13px;font-weight:600;color:#2f5d3a;cursor:pointer">${open?'Hide':'Show'} payment history (${st.history.length})</button>
  ${open?html`<div style="background:#f7f9f4;border-radius:10px;padding:8px 10px;display:grid;gap:2px;max-height:260px;overflow:auto">${st.history.map(p=>html`<div style="display:grid;grid-template-columns:70px minmax(0,1fr) auto 28px;gap:8px;align-items:center;font-size:13px;opacity:${p.counted?1:.6}"><span style="color:#5a6b63;font-variant-numeric:tabular-nums">${A.fmtDate(p.date)}</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.source==='bank'?title(p.name):'Recorded by you'}${p.counted?'':html` <span style="color:#5a6b63">· before balance date</span>`}</span><b style="font-variant-numeric:tabular-nums">${A.money(p.amount,2)}</b><button onClick=${()=>p.source==='bank'?updLoan(A,l.id,x=>({...x,rejectedTx:[...new Set([...(x.rejectedTx||[]),p.txId])]})):updLoan(A,l.id,x=>({...x,payments:(x.payments||[]).filter(y=>y.id!==p.id)}))} aria-label=${p.source==='bank'?`Unlink payment on ${p.date}`:`Remove payment on ${p.date}`} title=${p.source==='bank'?'Not a payment for this':'Remove'} class="hv-danger" style="border:0;background:transparent;border-radius:6px;color:#9a3d2a;cursor:pointer;height:26px">✕</button></div>`)}</div>`:null}
 </div>`;
}
function PayForm({A,l,label,onSave}){
 const S=A.state;if(S.payFor!==l.id)return null;
 const submit=e=>{e.preventDefault();const a=+S.payAmt;if(!(a>0))return;onSave(Math.round(a*100)/100,S.payDate||todayIso());A.setState({payFor:''});A.toast(`${A.money(a,2)} recorded`);};
 return html`<form onSubmit=${submit} style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;background:#f7f9f4;border-radius:12px;padding:12px"><label style=${fieldLabel+';flex:1;min-width:140px'}>${label}<${MoneyInput} value=${S.payAmt} onInput=${e=>A.setState({payAmt:e.target.value})}/></label><label style=${fieldLabel+';min-width:140px'}>Date<input type="date" value=${S.payDate||todayIso()} max=${todayIso()} onInput=${e=>A.setState({payDate:e.target.value})} class="fi" style=${inputSt}/></label><button type="button" onClick=${()=>A.setState({payFor:''})} style=${btn}>Cancel</button><button type="submit" style=${btnDark}>Save</button></form>`;
}
const stat=(label,value)=>html`<div style="background:#f7f9f4;border-radius:10px;padding:9px 11px;min-width:0"><div style="font-size:12px;color:#5a6b63">${label}</div><b style="font-size:14px;font-variant-numeric:tabular-nums">${value}</b></div>`;
const head=(icon,bg,fg,name,sub,tag,tagBg,tagFg)=>html`<div style="display:flex;gap:12px;align-items:flex-start"><span aria-hidden="true" style=${`width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:${bg};color:${fg};font-size:17px;flex:none`}>${icon}</span><div style="flex:1;min-width:0"><${H2}>${name}</${H2}><div style="font-size:13px;color:#5a6b63">${sub}</div></div>${tag?html`<span style=${`font-size:11px;font-weight:700;padding:3px 8px;border-radius:10px;background:${tagBg};color:${tagFg};white-space:nowrap`}>${tag}</span>`:null}</div>`;
const bar=(pct,color,label)=>html`<div role="progressbar" aria-valuenow=${Math.round(pct)} aria-valuemin="0" aria-valuemax="100" aria-label=${label} style="height:10px;background:#edf1e9;border-radius:6px;overflow:hidden"><div style=${`height:100%;width:${pct}%;background:${color};border-radius:6px;transition:width .3s`}></div></div>`;
function actions(A,l,payLabel,{remind}={}){
 return html`<div style="display:flex;gap:8px;flex-wrap:wrap"><button onClick=${()=>A.setState({payFor:A.state.payFor===l.id?'':l.id,payAmt:String(l.payment||''),payDate:todayIso()})} class="hv-pill" style=${pill}>${payLabel}</button><button onClick=${()=>A.setState({loanForm:formFrom(l),loanErr:''},()=>window.scrollTo({top:0,behavior:'smooth'}))} class="hv-pill" style=${pill}>Edit</button>${remind?html`<button onClick=${()=>A.toast(`Reminders aren’t sent automatically. Message ${l.who} yourself when you’re ready.`)} class="hv-pill" style=${pill}>Friendly reminder</button>`:null}<button onClick=${()=>{if(!confirm(`Remove “${l.name}”? Its payment history goes too.`))return;A.setState(st=>({loans:st.loans.filter(x=>x.id!==l.id)}));A.toast(`Removed ${l.name}`);}} aria-label=${`Remove ${l.name}`} class="hv-danger" style=${pill+';color:#9a3d2a;border-color:#efcfc5'}>Remove</button></div>`;
}

function LoanCard({A,J,v,pad,taken}){
 const S=A.state,l=v.l,st=v.st,owe=v.owe,ex=S.extra[l.id]||0,mx=J.loanMath({...l,balance:st.balance},ex),saved=v.m.months&&mx.months?v.m.months-mx.months:0,rate=l.rate==null?null:+l.rate;
 const addPay=(amount,date)=>updLoan(A,l.id,x=>({...x,payments:[...(x.payments||[]),{id:'p'+Date.now(),date,amount}]}));
 return html`<article key=${l.id} aria-label=${l.name} style=${card(pad)}>
  ${head(owe?'↗':'↙',owe?'#f8e7e3':'#e6f0dc',owe?'#a3412f':'#2f5d3a',l.name,owe?`Owed to ${l.who}`:`${l.who} owes you`,l.connected?`Connected · ${l.institution||'bank'}`:'Added by you',l.connected?'#e3ecf6':'#eef1ea',l.connected?'#2c5577':'#3d4d45')}
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap"><div><div style="font-size:12px;color:#5a6b63">${owe?'Left to pay':'Still to come back'}</div><div style="font:400 36px/1.1 'Instrument Serif',serif;letter-spacing:-.3px;font-variant-numeric:tabular-nums">${A.money(st.balance,2)}</div></div><div style="text-align:right;font-size:13px;color:#3d4d45">${A.money(st.original-st.balance)} ${owe?'paid':'repaid'} of ${A.money(st.original)}${st.paidSince>0?html`<div style="font-size:12px;color:#2f5d3a">${A.money(st.paidSince,2)} since ${A.fmtDate(l.balanceAsOf)}</div>`:null}</div></div>
  ${bar(st.pct,owe?'#c47a4e':'#315e4e',`${Math.round(st.pct)}% ${owe?'paid off':'repaid'}`)}
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${stat(owe?'Monthly':'Expected monthly',l.payment?A.money(l.payment):'—')}${stat('Interest',rate==null?'—':rate?`${rate}%`:'None')}${stat(owe?'Paid off by':'Back by',v.endLabel)}</div>
  ${owe&&l.payment>0&&st.balance>0?html`<div style="border:1px solid #dfe6d6;background:#f0f4e8;border-radius:12px;padding:12px;display:grid;gap:8px"><div style="font-size:13px;font-weight:600">What if you paid a bit more each month?</div><div role="group" aria-label="Extra monthly payment" style="display:flex;gap:6px;flex-wrap:wrap">${[0,50,100,250].map(x=>{const a=ex===x;return html`<button onClick=${()=>A.setState(s=>({extra:{...s.extra,[l.id]:x}}))} aria-pressed=${a} style=${`border:1px solid ${a?'#183c35':'#cdd6ca'};background:${a?'#183c35':'#fff'};color:${a?'#fff':'#183c35'};border-radius:999px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer`}>${x?`+${A.money(x)}`:'As is'}</button>`;})}</div><div aria-live="polite" style=${`font-size:13px;color:${ex&&saved>0?'#2f5d3a':'#3d4d45'}`}>${ex&&saved>0?`You’d be done ${saved} month${saved>1?'s':''} sooner${rate?` and save ${A.money(v.m.interest-mx.interest)} in interest`:''}.`:rate?`At ${rate}% you’ll pay about ${A.money(v.m.interest||0)} in interest at this pace.`:rate==null?'Interest isn’t reported for this loan, so this assumes none.':'No interest on this one, so paying more just finishes it sooner.'}</div></div>`:null}
  <${Matches} A=${A} l=${l} J=${J} taken=${taken}/>
  <${PayForm} A=${A} l=${l} label=${owe?'Payment amount':'Amount they paid back'} onSave=${addPay}/>
  <${History} A=${A} l=${l} st=${st}/>
  ${l.connected?html`<p style="margin:0;font-size:12px;color:#5a6b63">Balance comes from your bank and updates when you sync.</p>`:actions(A,l,owe?'Record a payment':'Record repayment',{remind:!owe})}
 </article>`;
}
function SomedayCard({A,J,v,pad,taken}){
 const l=v.l,st=v.st,addPay=(amount,date)=>updLoan(A,l.id,x=>({...x,payments:[...(x.payments||[]),{id:'p'+Date.now(),date,amount}]}));
 return html`<article key=${l.id} aria-label=${l.name} style=${card(pad)}>
  ${head('◷','#eee9f6','#5b4d8a',l.name,`From ${l.who}`,l.gentle?'No pressure':'Repay someday',l.gentle?'#f3eefc':'#eef1ea',l.gentle?'#5b4d8a':'#3d4d45')}
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap"><div><div style="font-size:12px;color:#5a6b63">You’d like to repay</div><div style="font:400 36px/1.1 'Instrument Serif',serif;letter-spacing:-.3px;font-variant-numeric:tabular-nums">${A.money(st.balance,2)}</div></div><div style="text-align:right;font-size:13px;color:#3d4d45">${st.original>st.balance?`${A.money(st.original-st.balance)} repaid so far`:'Nothing repaid yet'}</div></div>
  ${bar(st.pct,'#7a6aa8',`${Math.round(st.pct)}% repaid`)}
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${stat('Repay by',l.targetDate?monthLabel(l.targetDate):'Whenever you’re ready')}${stat('Set aside',st.monthlyToTarget?`${A.money(st.monthlyToTarget)}/mo`:'—')}</div>
  <p style="margin:0;font-size:13px;color:#3d4d45;background:#f7f9f4;border-radius:8px;padding:8px 10px">${l.targetDate&&st.balance>0?`Setting aside ${A.money(st.monthlyToTarget)} a month gets you there by ${monthLabel(l.targetDate)}. It’s included in your plan on Projections.`:'Add a “repay by” date to see how much to set aside each month.'} Not counted as debt.</p>
  <${Matches} A=${A} l=${l} J=${J} taken=${taken}/>
  <${PayForm} A=${A} l=${l} label="Amount repaid" onSave=${addPay}/>
  <${History} A=${A} l=${l} st=${st}/>
  ${actions(A,l,'Record repayment')}
 </article>`;
}
function GoalCard({A,x,pad}){
 const S=A.state,g=x.g,st=x.st,open=S.payFor===g.id;
 const submit=e=>{e.preventDefault();const a=+S.payAmt;if(!a)return;updGoal(A,g.id,y=>({...y,contributions:[...(y.contributions||[]),{id:'c'+Date.now(),date:S.payDate||todayIso(),amount:Math.round(a*100)/100}]}));A.setState({payFor:''});A.toast(`${A.money(a,2)} added to ${g.name}`);};
 return html`<article key=${g.id} aria-label=${g.name} style=${card(pad)}>
  ${head('★','#fbefd9','#7a5520',g.name,g.targetDate?`Target ${monthLabel(g.targetDate)}`:'No target date',st.done?'Reached':'Savings goal',st.done?'#e6f0dc':'#fbefd9',st.done?'#2f5d3a':'#7a5520')}
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap"><div><div style="font-size:12px;color:#5a6b63">Saved</div><div style="font:400 36px/1.1 'Instrument Serif',serif;letter-spacing:-.3px;font-variant-numeric:tabular-nums">${A.money(st.saved)}</div></div><div style="text-align:right;font-size:13px;color:#3d4d45">of ${A.money(st.target)} · ${Math.round(st.pct)}%</div></div>
  ${bar(st.pct,'#b08a2e',`${Math.round(st.pct)}% saved`)}
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${stat('Still to save',A.money(st.left))}${stat('Set aside',st.monthly?`${A.money(st.monthly)}/mo`:st.done?'Done':'—')}</div>
  ${open?html`<form onSubmit=${submit} style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;background:#f7f9f4;border-radius:12px;padding:12px"><label style=${fieldLabel+';flex:1;min-width:140px'}>Amount saved<${MoneyInput} value=${S.payAmt} onInput=${e=>A.setState({payAmt:e.target.value})}/></label><label style=${fieldLabel+';min-width:140px'}>Date<input type="date" value=${S.payDate||todayIso()} max=${todayIso()} onInput=${e=>A.setState({payDate:e.target.value})} class="fi" style=${inputSt}/></label><button type="button" onClick=${()=>A.setState({payFor:''})} style=${btn}>Cancel</button><button type="submit" style=${btnDark}>Save</button></form>`:null}
  ${(g.contributions||[]).length?html`<div style="font-size:12px;color:#5a6b63">${g.contributions.length} addition${g.contributions.length>1?'s':''}, latest ${A.fmtDate(g.contributions.at(-1).date)} · <button onClick=${()=>{updGoal(A,g.id,y=>({...y,contributions:y.contributions.slice(0,-1)}));A.toast('Last addition removed');}} style="border:0;background:none;padding:0;color:#9a3d2a;font-size:12px;cursor:pointer;text-decoration:underline">undo last</button></div>`:null}
  <div style="display:flex;gap:8px;flex-wrap:wrap"><button onClick=${()=>A.setState({payFor:open?'':g.id,payAmt:String(st.monthly||''),payDate:todayIso()})} class="hv-pill" style=${pill}>Add savings</button><button onClick=${()=>A.setState({loanForm:formFrom(g),loanErr:''},()=>window.scrollTo({top:0,behavior:'smooth'}))} class="hv-pill" style=${pill}>Edit</button><button onClick=${()=>{if(!confirm(`Remove the goal “${g.name}”?`))return;A.setState(s=>({goals:(s.goals||[]).filter(y=>y.id!==g.id)}));A.toast(`Removed ${g.name}`);}} class="hv-danger" style=${pill+';color:#9a3d2a;border-color:#efcfc5'}>Remove</button></div>
 </article>`;
}

// ---------- page ----------
export function Loans({A,S,J,pad,gap}){
 const LS=loanSummary(A,J),fl=S.loanFilter,net=LS.owed-LS.owe;
 const taken=new Set(LS.views.flatMap(v=>v.st.history.filter(h=>h.txId).map(h=>h.txId)));
 const filters=[['all','All'],['owe','I owe'],['owed','Owed to me'],['someday','Repay someday'],['goals','Goals']];
 const show=v=>fl==='all'||(fl==='someday'?v.someday:fl==='goals'?false:!v.someday&&v.l.dir===fl);
 const shown=LS.views.filter(show),goals=fl==='all'||fl==='goals'?LS.goals:[];
 return html`
  <${Kpis} items=${[{label:'You owe',value:A.money(LS.owe),note:`${A.money(LS.monthly)} in payments each month`,dark:true},{label:'Owed to you',value:A.money(LS.owed),note:LS.owedMonthly?`about ${A.money(LS.owedMonthly)}/mo coming back`:'nothing outstanding'},{label:'Repay someday',value:A.money(LS.someday),note:LS.somedayN?`${LS.somedayN} plan${LS.somedayN>1?'s':''} · not counted as debt`:'nothing planned'},{label:'Saved for goals',value:A.money(LS.saved),note:LS.goals.length?`of ${A.money(LS.goalTarget)} across ${LS.goals.length} goal${LS.goals.length>1?'s':''}`:'no goals yet'},{label:'Debt-free by',value:LS.debtEnd?LS.debtEnd.endLabel:'—',note:LS.debtEnd?`when your ${LS.debtEnd.l.name} is paid off`:LS.oweN?'add monthly payments to estimate':`net position ${(net>=0?'+':'−')+A.money(Math.abs(net))}`}]}/>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
   <div role="group" aria-label="Filter" style="display:flex;flex-wrap:wrap;gap:2px;background:#edf0e9;border:1px solid #dfe5db;border-radius:10px;padding:3px">${filters.map(([id,label])=>{const a=fl===id;return html`<button onClick=${()=>A.setState({loanFilter:id})} aria-pressed=${a} style=${`border:0;border-radius:7px;padding:7px 13px;font-size:14px;font-weight:${a?700:500};background:${a?'#fff':'transparent'};color:${a?'#183c35':'#4f5f57'};box-shadow:${a?'0 1px 3px #183c3522':'none'};cursor:pointer;min-height:36px`}>${label}</button>`;})}</div>
   <button onClick=${()=>A.setState({loanForm:S.loanForm?null:blankForm(fl==='goals'?'goal':fl==='someday'?'someday':fl==='owed'?'owed':'owe'),loanErr:''})} aria-expanded=${!!S.loanForm} style=${btnDark}>${S.loanForm?'Close':'＋ Add'}</button>
  </div>
  ${S.loanForm?html`<${LoanForm} A=${A} S=${S} pad=${pad}/>`:null}
  <div style=${`display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr));gap:${gap};align-items:start`}>
   ${shown.map(v=>v.someday?html`<${SomedayCard} key=${v.l.id} A=${A} J=${J} v=${v} pad=${pad} taken=${taken}/>`:html`<${LoanCard} key=${v.l.id} A=${A} J=${J} v=${v} pad=${pad} taken=${taken}/>`)}
   ${goals.map(x=>html`<${GoalCard} key=${x.g.id} A=${A} x=${x} pad=${pad}/>`)}
  </div>
  ${!shown.length&&!goals.length?empty(fl==='goals'?'No goals yet. Use “Add” to start saving for something.':'Nothing here yet. Use “Add” to track a loan, money you lent, a future repayment or a savings goal.'):null}
  <p style="margin:0;font-size:13px;color:#5a6b63;text-wrap:pretty">Saved in your private database. Matching payments are only linked after you confirm them, and balances you enter count from the day you enter them. Payoff dates assume the same payment every month.</p>`;
}

// ---------- Overview card + Projections section ----------
export function goalsCardBody(A,LS,avgKept){
 const items=LS.plans.items;
 if(!items.length)return empty('Add savings goals or money you plan to repay from the Loans & IOUs page.');
 const need=LS.plans.monthly,ok=avgKept>=need;
 return html`<div style="display:flex;gap:24px;flex-wrap:wrap"><div><div style="font-size:12px;color:#5a6b63">Set aside each month</div><div style="font:400 31px/1.1 'Instrument Serif',serif;letter-spacing:-.8px">${A.money(need)}</div></div><div><div style="font-size:12px;color:#5a6b63">You usually keep</div><div style=${`font:400 31px/1.1 'Instrument Serif',serif;letter-spacing:-.8px;color:${ok?'#2f5d3a':'#9a3d2a'}`}>${A.money(avgKept)}</div></div></div>
  ${LS.goals.slice(0,3).map(x=>html`<div style="display:grid;gap:6px"><div style="display:flex;justify-content:space-between;gap:10px;font-size:14px"><span style="font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">★ ${x.g.name}</span><span style="font-variant-numeric:tabular-nums;white-space:nowrap">${A.money(x.st.saved)} of ${A.money(x.st.target)}</span></div>${bar(x.st.pct,'#b08a2e',`${Math.round(x.st.pct)}% saved`)}<div style="font-size:12px;color:#5a6b63">${x.st.done?'Reached':x.st.monthly?`${A.money(x.st.monthly)}/mo to reach it by ${monthLabel(x.g.targetDate)}`:'No target date'}</div></div>`)}
  ${LS.plans.someday.filter(x=>x.s.balance>0).slice(0,2).map(x=>html`<div style="font-size:13px;display:flex;justify-content:space-between;gap:10px"><span>◷ Repay ${x.l.who}: ${x.l.name}</span><b style="font-variant-numeric:tabular-nums;white-space:nowrap">${A.money(x.s.balance)}</b></div>`)}
  <p style="margin:0;font-size:12px;color:${ok?'#2f5d3a':'#9a3d2a'}">${ok?`Your usual monthly surplus covers this with ${A.money(avgKept-need)} to spare.`:`You’re about ${A.money(need-avgKept)} a month short. See Projections for ways to close the gap.`}</p>`;
}
export function PlansSection({A,J,pl,pad}){
 const LS=loanSummary(A,J),items=LS.plans.items,need=LS.plans.monthly,kept=pl.keptScen,left=kept-need;
 return html`<section aria-labelledby="plans-h" style=${card(pad)}>
  <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><${H2} id="plans-h">Your plans</${H2}><${Sub}>Savings goals and money you’d like to repay, from Loans & IOUs</${Sub}></div><button onClick=${()=>A.go('loans',{loanFilter:'goals',loanForm:blankForm('goal'),loanErr:''})} class="hv-pill" style=${pill}>＋ Add a goal</button></div>
  ${items.length?html`<div style="display:grid;gap:2px">${items.map(i=>html`<div style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:8px 0;border-top:1px solid #eef1ea;font-size:14px"><span style="min-width:0"><b>${i.type==='goal'?'★':'◷'} ${i.name}</b><span style="color:#5a6b63;font-size:12px"> · ${A.money(i.left)} to go${i.targetDate?` by ${monthLabel(i.targetDate)}`:''}</span></span><span style="font-size:12px;color:#5a6b63">${i.monthly?'per month':'no date'}</span><b style="font-variant-numeric:tabular-nums;min-width:80px;text-align:right">${i.monthly?A.money(i.monthly):'—'}</b></div>`)}</div>
   <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:8px">${stat('Plans need each month',A.money(need))}${stat('You keep each month',A.money(kept))}<div style=${`background:${left>=0?'#eef5e8':'#fbefeb'};border-radius:10px;padding:9px 11px`}><div style="font-size:12px;color:#5a6b63">${left>=0?'Left after your plans':'Short each month'}</div><b style=${`font-size:14px;font-variant-numeric:tabular-nums;color:${left>=0?'#2f5d3a':'#9a3d2a'}`}>${A.money(Math.abs(left))}</b></div></div>
   <p style="margin:0;font-size:13px;color:#3d4d45">${left>=0?`With the changes above, your plans are covered and ${A.money(left)} a month is still free.`:`Try the changes above, such as cutting a category or cancelling a subscription, to free up ${A.money(-left)} a month, or push a target date later.`} Money set aside stays in your accounts, so the balance chart already includes it.</p>`
  :empty('Add a savings goal (kids, a home, a big opportunity) or money you’d like to repay someday, and this shows how much to set aside each month.')}
 </section>`;
}
