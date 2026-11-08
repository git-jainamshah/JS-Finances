import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestMatches,linkedPayments,loanState,goalState,planSummary,scorePayment,describeForChat} from '../loans.mjs';

const tx=(id,date,name,amount,extra={})=>({id,date,name,amount,currency:'CAD',kind:'expense',pending:false,...extra});
const rows=[
 tx('a','2026-08-03','UPGRADE INC LOAN PMT 8812',312.4),tx('b','2026-09-03','UPGRADE INC LOAN PMT 8812',312.4),tx('c','2026-10-03','UPGRADE INC LOAN PMT 8812',312.4),
 tx('d','2026-10-20','UPGRADE INC LOAN PMT 8812',50),
 tx('e','2026-09-05','LOBLAWS',310),tx('f','2026-10-05','LOBLAWS',305),
 tx('g','2026-10-02','PAYMENT - THANK YOU',312.4,{kind:'credit_payment'}),
];
const loan={id:'l1',dir:'owe',name:'Personal loan',who:'Upgrade',platform:'',balance:5000,original:6000,payment:300,day:1,balanceAsOf:'2026-07-01'};

test('suggests the lender payments with reasons and ignores unrelated or card payments',()=>{
 const s=suggestMatches(loan,rows,{today:'2026-11-08'}).filter(x=>x.tier===1);
 assert.equal(s.length,1);
 assert.equal(s[0].confidence,'Medium');
 assert.equal(suggestMatches({...loan,platform:'Upgrade Inc'},rows,{today:'2026-11-08'})[0].confidence,'High');
 assert.match(s[0].reasons.join(' '),/Upgrade/);
 assert.ok(!s[0].txIds.includes('g'));
});
test('amount within ~5% and no name does not match a grocery store',()=>{
 assert.equal(scorePayment({...loan,who:'Mom',name:'Rent help'},rows[4]).name,0);
});
test('dismissed descriptions are not suggested again',()=>{
 const key=suggestMatches(loan,rows)[0].key;
 assert.equal(suggestMatches({...loan,dismissedKeys:[key]},rows,{today:'2026-11-08'}).filter(x=>x.tier===1).length,0);
});
test('linked payments reduce the balance; outliers and unlinked ones do not',()=>{
 const key=suggestMatches(loan,rows)[0].key,l={...loan,matchKeys:[key]};
 assert.equal(linkedPayments(l,rows).length,3);
 assert.equal(loanState(l,rows,'2026-11-08').balance,5000-312.4*3);
 assert.equal(loanState({...l,rejectedTx:['a']},rows,'2026-11-08').balance,Math.round((5000-312.4*2)*100)/100);
 assert.equal(loanState({...l,balanceAsOf:'2026-11-01'},rows,'2026-11-08').balance,5000);
});
test('manual payments on or after the balance date count',()=>{
 const s=loanState({...loan,payments:[{id:'p',date:'2026-07-01',amount:100},{id:'q',date:'2026-06-01',amount:100}]},[],'2026-11-08');
 assert.equal(s.balance,4900);assert.equal(s.history.length,2);
});
test('repay-someday and goals work out a monthly amount',()=>{
 const someday={id:'s',dir:'owe',kind:'someday',name:'Condo help',who:'Mom & Dad',balance:3000,targetDate:'2027-11-01',balanceAsOf:'2026-11-08'};
 assert.equal(loanState(someday,[],'2026-11-08').monthlyToTarget,250);
 const g=goalState({target:10000,saved:2500,targetDate:'2028-11-01',contributions:[{amount:100}]},'2026-11-08');
 assert.equal(g.saved,2600);assert.equal(g.monthly,309);
 const p=planSummary([someday,loan],[{id:'g',name:'Kids',target:10000,saved:2600,targetDate:'2028-11-01'}],[],'2026-11-08');
 assert.equal(p.items.length,2);assert.equal(p.monthly,250+309);
 assert.match(describeForChat([someday],[]).loans,/repay someday/i);
});

test('name on bank statements wins over the loan title and lender, and groups description variants',()=>{
 const trip={id:'m',dir:'owe',name:'Mexico Vacation Loan',who:'Air Canada',platform:'UPGRADE INC',balance:2400,payment:210,day:5,balanceAsOf:'2026-01-01'};
 const data=[
  tx('1','2026-10-06','UPGRADE INC LOAN 8812',212.5),tx('2','2026-09-05','UPGRADE INC LOAN 8812',212.5),tx('3','2026-08-05','PAD UPGRADE',212.5),tx('4','2026-07-07','UPGRADE INC 1',212.5),
  tx('5','2026-10-05','AIR CANADA',209),tx('6','2026-09-05','AIR CANADA',205),tx('7','2026-08-05','AIR CANADA',212),
 ];
 const s=suggestMatches(trip,data,{today:'2026-11-08'});
 assert.equal(s[0].tier,1);assert.equal(s[0].platform,true);assert.equal(s[0].count,4);
 assert.ok(!s.filter(x=>x.tier===1).some(x=>/AIR CANADA/.test(x.name)));
 const linked={...trip,matchKeys:s[0].keys,matchPlatform:true};
 const later=[...data,tx('8','2026-11-05','UPGRADE PAYMENT',212.5)];
 assert.equal(linkedPayments(linked,later).length,5);
 assert.equal(suggestMatches(linked,later,{today:'2026-11-08'}).filter(x=>x.platform).length,0);
});
test('recent payments rank ahead of an older, stopped pattern',()=>{
 const l={id:'r',dir:'owe',name:'Car',who:'Bank',platform:'',balance:9000,payment:300,day:10,balanceAsOf:'2026-01-01'};
 const data=[tx('a1','2026-10-10','PAD ABC FIN',300),tx('a2','2026-09-10','PAD ABC FIN',300),tx('a3','2026-08-10','PAD ABC FIN',300),tx('b1','2024-03-10','OLD LENDER',300),tx('b2','2024-02-10','OLD LENDER',300),tx('b3','2024-01-10','OLD LENDER',300)];
 const s=suggestMatches(l,data,{today:'2026-11-08'});
 assert.equal(s[0].name,'PAD ABC FIN');assert.equal(s[0].tier,1);
 assert.ok(s.findIndex(x=>x.name==='OLD LENDER')!==0);
});

test('card-payment labelled lender payments match when the bank-statement name is given',()=>{
 const l={id:'x',dir:'owe',name:'Mexico Vacation Loan',who:'Air Canada',platform:'Upgrade',balance:1893.02,payment:137.16,day:24,rate:31,balanceAsOf:'2026-01-01'};
 const data=[1,2,3,4].map(i=>tx('u'+i,`2026-${String(10-i).padStart(2,'0')}-24`,'Upgrade',137.16,{kind:'credit_payment'}));
 const s=suggestMatches(l,data,{today:'2026-11-08'});
 assert.equal(s[0].tier,1);assert.equal(s[0].confidence,'High');assert.equal(s[0].count,4);
});
test('an example transaction alone is enough to find the rest',()=>{
 const l={id:'y',dir:'owe',name:'Couch',who:'Store',platform:'',balance:900,payment:0,day:1,balanceAsOf:'2026-01-01',example:{id:'a1',name:'AFFIRM *CANADA',amount:75,date:'2026-10-12'}};
 const data=[tx('a1','2026-10-12','AFFIRM *CANADA',75),tx('a2','2026-09-12','AFFIRM CA PAYMENT',75),tx('a3','2026-08-13','AFFIRM *CANADA',75,{kind:'transfer'})];
 const s=suggestMatches(l,data,{today:'2026-11-08'});
 assert.equal(s[0].count,3);assert.equal(s[0].tier,1);
});
test('lines of credit and the debt plan',async()=>{
 const {locState,debtPlan,simulatePayoff,loanPaymentIds}=await import('../loans.mjs');
 const acct={id:'loc',name:'ScotiaLine',institution:'Scotiabank',class:'credit_line',balance:8200,limit:10000};
 const rows=[];for(let i=1;i<=6;i++){const m=`2026-${String(11-i).padStart(2,'0')}`;rows.push(tx('d'+i,`${m}-10`,'TRANSFER',600,{accountId:'loc'}),tx('p'+i,`${m}-20`,'PAYMENT',-400,{accountId:'loc'}),tx('i'+i,`${m}-28`,'INTEREST CHARGES',62,{accountId:'loc'}));}
 const st=locState(acct,rows,'2026-11-08');
 assert.equal(st.paid,400);assert.equal(st.drawn,600);assert.equal(st.interest,62);assert.equal(st.net,-262);assert.equal(st.monthsAtPace,null);assert.ok(st.estRate>9&&st.estRate<9.2);
 const plan={income:5000,outBase:5300,keptBase:-300,groups:[{name:'Dining out',base:600,flexible:true},{name:'Shopping',base:400,flexible:true},{name:'Rent',base:2000,flexible:false}],subs:[]};
 const p=debtPlan({plan,accounts:[acct,{id:'c',name:'Visa',institution:'RBC',class:'credit_card',balance:2000,limit:5000}],transactions:rows,cash:200,today:'2026-11-08'});
 assert.equal(p.status,'overspending');assert.equal(p.steps[0].id,'gap');assert.equal(p.steps[0].cuts.reduce((s,c)=>s+c.amount,0),300);
 assert.ok(p.steps.some(s=>s.id==='loc-loc'));
 const a=simulatePayoff([{name:'A',balance:1000,rate:20,min:50},{name:'B',balance:1000,rate:5,min:50}],0),b=simulatePayoff([{name:'A',balance:1000,rate:20,min:50},{name:'B',balance:1000,rate:5,min:50}],100);
 assert.ok(b.months<a.months&&b.interest<a.interest);assert.equal(b.order[0].name,'A');
 assert.equal(simulatePayoff([{name:'X',balance:10000,rate:30,min:50}],0).months,null);
 assert.deepEqual([...loanPaymentIds([{id:'z',dir:'owe',platform:'Upgrade',payment:137.16,matchKeys:['UPGRADE']}],[tx('q','2026-10-24','Upgrade',137.16,{kind:'credit_payment'})])],['q']);
});
