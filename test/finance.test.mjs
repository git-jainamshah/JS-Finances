import test from 'node:test';
import assert from 'node:assert/strict';
import {accountClass,exponentiallyWeightedAverage,normalize,classifyTransactions,summarize,applyChanges,demoData} from '../finance.mjs';
const t=(id,amount,primary,detailed='',extra={},account={})=>normalize({transaction_id:id,account_id:account.account_id,amount,date:extra.date||'2026-09-15',personal_finance_category:{primary,detailed,confidence_level:'HIGH'},iso_currency_code:'CAD',...extra},'',account);
test('income, refunds, transfers, card payments, pending and foreign currencies',()=>{
 const rows=[t('salary',-5000,'INCOME'),t('purchase',1000,'GENERAL_MERCHANDISE'),t('refund',-100,'GENERAL_MERCHANDISE'),t('transfer',-500,'TRANSFER_IN'),t('cardpay',900,'LOAN_PAYMENTS','LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'),t('pending',400,'FOOD_AND_DRINK','',{pending:true}),t('usd',800,'TRAVEL','',{iso_currency_code:'USD'})];
 assert.deepEqual(summarize(rows),{income:5000,spending:900,payments:900,refunds:100,surplus:4100,savingsRate:82});
});
test('negative unclassified transactions are refunds, not invented income',()=>{assert.equal(t('x',-30,'UNCATEGORIZED').kind,'refund');assert.equal(summarize([]).savingsRate,null);});
test('forecast weighting starts from the first observation',()=>{assert.equal(exponentiallyWeightedAverage([100,200]),135);assert.equal(exponentiallyWeightedAverage([]),0);});
test('credit-card payments are transfers, never income',()=>{
 const card={account_id:'amex',type:'credit',subtype:'credit card',name:'Cobalt'};
 const payment=t('payment',-2546.62,'INCOME','',{name:'PAYMENT RECEIVED - THANK YOU'},card);
 assert.equal(payment.kind,'credit_payment');assert.equal(payment.category,'Credit card payments');
 assert.equal(payment.review,false);
 assert.deepEqual(summarize([payment]),{income:0,spending:0,payments:2546.62,refunds:0,surplus:0,savingsRate:null});
});
test('credit lines are identified from subtype or account name',()=>{assert.equal(accountClass({type:'credit',subtype:'line of credit'}),'credit_line');assert.equal(accountClass({type:'credit',subtype:'credit card',name:'ScotiaLine Line of Credit'}),'credit_line');});
test('obvious cash-side credit-card bill payments are excluded from spending',()=>{
 const cash={account_id:'cash',type:'depository',subtype:'checking',name:'Preferred Package'};
 const payment=t('ctfs',35.26,'LOAN_PAYMENTS','LOAN_PAYMENTS_OTHER_PAYMENT',{name:'Bill Payment CANADIAN TIRE BANK'},cash);
 assert.equal(payment.kind,'credit_payment');assert.equal(payment.review,false);assert.equal(summarize([payment]).spending,0);
});
test('matching card payments and merchant refunds use account context',()=>{
 const accounts=[{account_id:'cash',type:'depository',subtype:'checking',name:'Chequing'},{account_id:'card',type:'credit',subtype:'credit card',name:'Card'}];
 const raw=[
  {transaction_id:'cash-pay',account_id:'cash',date:'2026-09-14',name:'AMEX PAYMENT',amount:500,iso_currency_code:'CAD',personal_finance_category:{primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',confidence_level:'HIGH'}},
  {transaction_id:'card-pay',account_id:'card',date:'2026-09-15',name:'PAYMENT RECEIVED - THANK YOU',amount:-500,iso_currency_code:'CAD',personal_finance_category:{primary:'INCOME',detailed:'INCOME_OTHER_INCOME',confidence_level:'LOW'}},
  {transaction_id:'purchase',account_id:'card',date:'2026-08-20',name:'INDIGO',amount:62,iso_currency_code:'CAD',personal_finance_category:{primary:'GENERAL_MERCHANDISE',detailed:'GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS',confidence_level:'HIGH'}},
  {transaction_id:'refund',account_id:'card',date:'2026-09-01',name:'INDIGO REFUND',amount:-62,iso_currency_code:'CAD',personal_finance_category:{primary:'GENERAL_MERCHANDISE',detailed:'GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS',confidence_level:'LOW'}}
 ];
 const rows=classifyTransactions(raw,accounts,'Bank');assert.equal(rows.find(x=>x.id==='cash-pay').kind,'transfer');assert.equal(rows.find(x=>x.id==='card-pay').kind,'credit_payment');assert.equal(rows.find(x=>x.id==='refund').kind,'refund');assert.equal(rows.find(x=>x.id==='refund').review,false);assert.equal(summarize(rows).spending,0);
});
test('sync pages update, delete, deduplicate, and replace pending records',()=>{
 const existing=[{transaction_id:'pending',amount:20},{transaction_id:'modified',amount:10}];
 const pages=[{added:[{transaction_id:'posted',amount:22}],modified:[{transaction_id:'modified',amount:12}],removed:[{transaction_id:'pending'}]}];
 const once=applyChanges(existing,pages);assert.deepEqual(once,[{transaction_id:'modified',amount:12},{transaction_id:'posted',amount:22}]);assert.deepEqual(applyChanges(once,pages),once);assert.equal(existing.length,2);
});
test('demo records reference valid accounts and include no future dates',()=>{const d=demoData();assert.ok(d.transactions.length>100);assert.equal(d.demo,true);for(const t of d.transactions){assert.ok(d.accounts.some(a=>a.id===t.accountId));assert.ok(new Date(t.date)<=new Date());}});
