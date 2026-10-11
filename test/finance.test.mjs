import test from 'node:test';
import assert from 'node:assert/strict';
import {accountClass,exponentiallyWeightedAverage,robustWeightedAverage,normalize,classifyTransactions,summarize,applyChanges,demoData,isRentPayment} from '../finance.mjs';
const t=(id,amount,primary,detailed='',extra={},account={})=>normalize({transaction_id:id,account_id:account.account_id,amount,date:extra.date||'2026-09-15',personal_finance_category:{primary,detailed,confidence_level:'HIGH'},iso_currency_code:'CAD',...extra},'',account);
test('income, refunds, transfers, card payments, pending and foreign currencies',()=>{
 const rows=[t('salary',-5000,'INCOME'),t('purchase',1000,'GENERAL_MERCHANDISE'),t('refund',-100,'GENERAL_MERCHANDISE'),t('transfer',-500,'TRANSFER_IN'),t('cardpay',900,'LOAN_PAYMENTS','LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'),t('pending',400,'FOOD_AND_DRINK','',{pending:true}),t('usd',800,'TRAVEL','',{iso_currency_code:'USD'})];
 assert.deepEqual(summarize(rows),{income:5000,earnedIncome:5000,contributions:0,spending:900,payments:900,refunds:100,reimbursements:0,passThrough:0,surplus:4100,savingsRate:82});
});
test('negative unclassified transactions are refunds, not invented income',()=>{assert.equal(t('x',-30,'UNCATEGORIZED').kind,'refund');assert.equal(summarize([]).savingsRate,null);});
test('forecast weighting starts from the first observation',()=>{assert.equal(exponentiallyWeightedAverage([100,200]),135);assert.equal(exponentiallyWeightedAverage([]),0);});
test('robust forecast baseline limits one-off months',()=>{assert.ok(robustWeightedAverage([100,100,100,1000])<exponentiallyWeightedAverage([100,100,100,1000]));});
test('credit-card payments are transfers, never income',()=>{
 const card={account_id:'amex',type:'credit',subtype:'credit card',name:'Cobalt'};
 const payment=t('payment',-2546.62,'INCOME','',{name:'PAYMENT RECEIVED - THANK YOU'},card);
 assert.equal(payment.kind,'credit_payment');assert.equal(payment.category,'Credit card payments');
 assert.equal(payment.review,false);
 assert.deepEqual(summarize([payment]),{income:0,earnedIncome:0,contributions:0,spending:0,payments:2546.62,refunds:0,reimbursements:0,passThrough:0,surplus:0,savingsRate:null});
});
test('credit lines are identified from subtype or account name',()=>{assert.equal(accountClass({type:'credit',subtype:'line of credit'}),'credit_line');assert.equal(accountClass({type:'credit',subtype:'credit card',name:'ScotiaLine Line of Credit'}),'credit_line');});
test('obvious cash-side credit-card bill payments are excluded from spending',()=>{
 const cash={account_id:'cash',type:'depository',subtype:'checking',name:'Preferred Package'};
 const payment=t('ctfs',35.26,'LOAN_PAYMENTS','LOAN_PAYMENTS_OTHER_PAYMENT',{name:'Bill Payment CANADIAN TIRE BANK'},cash);
 assert.equal(payment.kind,'credit_payment');assert.equal(payment.review,false);assert.equal(summarize([payment]).spending,0);
});
test('Signet transactions are recognized as rent',()=>{
 const cash={account_id:'cash',type:'depository',subtype:'checking',name:'Preferred Package'};
 const rent=t('rent',2470.04,'RENT_AND_UTILITIES','RENT_AND_UTILITIES_RENT',{name:'Signet Management'},cash);
 assert.equal(rent.kind,'expense');assert.equal(rent.category,'Rent');assert.equal(rent.review,false);assert.equal(rent.classificationReason,'known rent merchant');assert.equal(isRentPayment(rent),true);
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
test('one recurring early-month e-transfer is household contribution income',()=>{
 const account={account_id:'cash',type:'depository',subtype:'checking',name:'Preferred Package'},raw=[];
 for(let month=1;month<=6;month++)raw.push({transaction_id:`rent-${month}`,account_id:'cash',date:`2026-${String(month).padStart(2,'0')}-04`,name:'DEPOSIT FREE INTERAC E-TRANSFER',amount:month<4?-550:-600,iso_currency_code:'CAD',personal_finance_category:{primary:'TRANSFER_IN',detailed:'TRANSFER_IN_ACCOUNT_TRANSFER',confidence_level:'HIGH'}});
 raw.push({...raw[0],transaction_id:'duplicate',date:'2026-01-06'});
 const rows=classifyTransactions(raw,[account],'Scotiabank'),summary=summarize(rows);
 assert.equal(rows.filter(row=>row.kind==='contribution').length,6);assert.equal(rows.find(row=>row.id==='duplicate').kind,'transfer');assert.equal(summary.contributions,3450);assert.equal(summary.earnedIncome,0);assert.equal(summary.income,3450);
});
test('large purchase matched to split e-transfer reimbursement is excluded',()=>{
 const accounts=[{account_id:'cash',type:'depository',subtype:'checking',name:'Preferred Package'},{account_id:'card',type:'credit',subtype:'credit card',name:'Scene+ Visa card'}],raw=[{transaction_id:'tuition',account_id:'card',date:'2025-11-12',name:'PAYMYTUITION 905-***9023 ON',amount:9791.92,iso_currency_code:'CAD',personal_finance_category:{primary:'GENERAL_SERVICES',detailed:'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',confidence_level:'HIGH'}},...[-3000,-3000,-3000,-972].map((amount,index)=>({transaction_id:`repay-${index}`,account_id:'cash',date:`2025-11-${24+index}`,name:'DEPOSIT FREE INTERAC E-TRANSFER',amount,iso_currency_code:'CAD',personal_finance_category:{primary:'TRANSFER_IN',detailed:'TRANSFER_IN_ACCOUNT_TRANSFER',confidence_level:'HIGH'}}))];
 const rows=classifyTransactions(raw,accounts,'Scotiabank'),summary=summarize(rows);
 assert.equal(rows.find(row=>row.id==='tuition').kind,'reimbursed_expense');assert.equal(rows.filter(row=>row.kind==='reimbursement').length,4);assert.equal(summary.spending,0);assert.equal(summary.passThrough,9791.92);assert.equal(summary.reimbursements,9972);
});
test('sync pages update, delete, deduplicate, and replace pending records',()=>{
 const existing=[{transaction_id:'pending',amount:20},{transaction_id:'modified',amount:10}];
 const pages=[{added:[{transaction_id:'posted',amount:22}],modified:[{transaction_id:'modified',amount:12}],removed:[{transaction_id:'pending'}]}];
 const once=applyChanges(existing,pages);assert.deepEqual(once,[{transaction_id:'modified',amount:12},{transaction_id:'posted',amount:22}]);assert.deepEqual(applyChanges(once,pages),once);assert.equal(existing.length,2);
});
test('demo records reference valid accounts and include no future dates',()=>{const d=demoData();assert.ok(d.transactions.length>100);assert.equal(d.demo,true);for(const t of d.transactions){assert.ok(d.accounts.some(a=>a.id===t.accountId));assert.ok(new Date(t.date)<=new Date());}});
