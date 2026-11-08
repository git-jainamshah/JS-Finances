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
