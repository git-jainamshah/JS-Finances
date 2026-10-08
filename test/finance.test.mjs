import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,summarize,applyChanges,demoData} from '../finance.mjs';
const t=(id,amount,primary,detailed='',extra={})=>normalize({transaction_id:id,amount,personal_finance_category:{primary,detailed,confidence_level:'HIGH'},iso_currency_code:'CAD',...extra});
test('income, refunds, transfers, card payments, pending and foreign currencies',()=>{
 const rows=[t('salary',-5000,'INCOME'),t('purchase',1000,'GENERAL_MERCHANDISE'),t('refund',-100,'GENERAL_MERCHANDISE'),t('transfer',-500,'TRANSFER_IN'),t('cardpay',900,'LOAN_PAYMENTS','LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'),t('pending',400,'FOOD_AND_DRINK','',{pending:true}),t('usd',800,'TRAVEL','',{iso_currency_code:'USD'})];
 assert.deepEqual(summarize(rows),{income:5000,spending:900,surplus:4100,savingsRate:82});
});
test('negative unclassified transactions are refunds, not invented income',()=>{assert.equal(t('x',-30,'UNCATEGORIZED').kind,'refund');assert.equal(summarize([]).savingsRate,null);});
test('sync pages update, delete, deduplicate, and replace pending records',()=>{
 const existing=[{transaction_id:'pending',amount:20},{transaction_id:'modified',amount:10}];
 const pages=[{added:[{transaction_id:'posted',amount:22}],modified:[{transaction_id:'modified',amount:12}],removed:[{transaction_id:'pending'}]}];
 const once=applyChanges(existing,pages);assert.deepEqual(once,[{transaction_id:'modified',amount:12},{transaction_id:'posted',amount:22}]);assert.deepEqual(applyChanges(once,pages),once);assert.equal(existing.length,2);
});
test('demo records reference valid accounts and include no future dates',()=>{const d=demoData();assert.ok(d.transactions.length>100);assert.equal(d.demo,true);for(const t of d.transactions){assert.ok(d.accounts.some(a=>a.id===t.accountId));assert.ok(new Date(t.date)<=new Date());}});
