const paymentWords=/\b(PAYMENT RECEIVED|THANK YOU|AUTOPAY|CARD PAYMENT|CREDIT CARD PAYMENT|PAYMENT -? THANK|PAYMENT THANK)\b/i;
const outgoingCardPaymentWords=/\b(?:BILL PAYMENT.*(?:BANK|VISA|MASTERCARD|MASTER CARD|AMEX|AMERICAN EXPRESS|CAPITAL ONE)|(?:VISA|MASTERCARD|MASTER CARD|AMEX|AMERICAN EXPRESS) PAYMENT)\b/i;
const refundWords=/\b(REFUND|RETURN|REVERSAL|CREDIT MEMO|MERCHANT CREDIT|PRICE ADJUSTMENT|CASHBACK)\b/i;
const labels={FOOD_AND_DRINK:'Food & dining',GENERAL_MERCHANDISE:'Shopping',RENT_AND_UTILITIES:'Home & bills',TRANSPORTATION:'Transport',ENTERTAINMENT:'Entertainment',GENERAL_SERVICES:'Services',TRAVEL:'Travel',MEDICAL:'Health',PERSONAL_CARE:'Personal care',BANK_FEES:'Bank fees',LOAN_PAYMENTS:'Loan payments',INCOME:'Income',GOVERNMENT_AND_NON_PROFIT:'Government & giving',HOME_IMPROVEMENT:'Home improvement',UNCATEGORIZED:'Needs review'};

export function accountClass(account={}){
  const type=String(account.type||'').toLowerCase(),subtype=String(account.subtype||'').toLowerCase(),description=[subtype,account.name,account.official_name,account.officialName].filter(Boolean).join(' ').toLowerCase();
  if(/line of credit|scotialine|home equity|overdraft/.test(description))return 'credit_line';
  if(type==='credit'||/credit card|paypal/.test(subtype))return 'credit_card';
  if(type==='loan')return 'loan';
  if(type==='investment')return 'investment';
  return 'cash';
}

export function normalize(t,institution='',account={}){
  const p=t.personal_finance_category||{},primary=p.primary||'UNCATEGORIZED',detail=p.detailed||'';
  const classification=accountClass(account),credit=['credit_card','credit_line'].includes(classification),name=t.merchant_name||t.name||'Unknown merchant';
  const explicitCardPayment=/CREDIT_CARD_PAYMENT/.test(detail),plaidTransfer=primary.startsWith('TRANSFER')||explicitCardPayment;
  const cardPayment=credit&&t.amount<0&&(paymentWords.test(name)||plaidTransfer)||!credit&&t.amount>0&&(explicitCardPayment||outgoingCardPaymentWords.test(name));
  const income=primary==='INCOME'&&!credit;
  const kind=cardPayment?'credit_payment':plaidTransfer?'transfer':income?'income':t.amount<0?'refund':'expense';
  const baseCategory=detail.includes('GROCERIES')?'Groceries':labels[primary]||primary.replaceAll('_',' ').toLowerCase();
  const category=cardPayment?'Credit card payments':plaidTransfer?'Transfers':kind==='refund'&&refundWords.test(name)?'Refunds':baseCategory;
  const confidence=p.confidence_level||null,ambiguousCredit=credit&&t.amount<0&&!cardPayment&&!refundWords.test(name);
  return {id:t.transaction_id,accountId:t.account_id,date:t.date,name,amount:t.amount,currency:t.iso_currency_code||t.unofficial_currency_code||'Unknown',pending:!!t.pending,category,kind,institution,accountName:account.name||'',accountType:account.type||'',accountSubtype:account.subtype||'',accountClass:classification,review:cardPayment?false:ambiguousCredit||!p.primary||!['HIGH','VERY_HIGH'].includes(confidence),classificationReason:cardPayment?'credit-account payment description':plaidTransfer?'Plaid transfer category':income?'Plaid income category':kind==='refund'?(refundWords.test(name)?'refund description':'credit or negative transaction'):'Plaid spending category'};
}

const dayDistance=(a,b)=>Math.abs((new Date(`${a}T12:00:00`)-new Date(`${b}T12:00:00`))/86400000);
const merchantKey=name=>String(name||'').toUpperCase().replace(/\b(REFUND|RETURN|REVERSAL|CREDIT|PURCHASE|POS|DEBIT)\b/g,'').replace(/[^A-Z0-9]/g,'').slice(0,28);
export function classifyTransactions(rawTransactions,accounts=[],institution=''){
  const accountMap=new Map(accounts.map(a=>[a.account_id||a.id,a]));
  const rows=rawTransactions.map(t=>normalize(t,institution,accountMap.get(t.account_id)||{}));
  const payments=rows.filter(t=>t.kind==='credit_payment');
  for(const payment of payments){
    const counterpart=rows.filter(t=>t.accountId!==payment.accountId&&t.currency===payment.currency&&t.amount>0&&Math.abs(t.amount+payment.amount)<.01&&dayDistance(t.date,payment.date)<=10).sort((a,b)=>dayDistance(a.date,payment.date)-dayDistance(b.date,payment.date))[0];
    if(counterpart){payment.pairedTransactionId=counterpart.id;counterpart.pairedTransactionId=payment.id;counterpart.kind='transfer';counterpart.category='Credit card payments';counterpart.review=false;counterpart.classificationReason='matched credit-card payment';}
  }
  const purchases=rows.filter(t=>t.kind==='expense'&&['credit_card','credit_line'].includes(t.accountClass));
  for(const row of rows.filter(t=>t.kind==='refund'&&['credit_card','credit_line'].includes(t.accountClass))){
    const key=merchantKey(row.name),match=purchases.find(p=>p.accountId===row.accountId&&p.currency===row.currency&&p.amount>0&&Math.abs(p.amount+row.amount)<.01&&dayDistance(p.date,row.date)<=180&&key&&merchantKey(p.name)===key);
    if(match){row.category='Refunds';row.review=false;row.matchedPurchaseId=match.id;row.classificationReason='matched merchant purchase';}
  }
  return rows;
}

export function summarize(transactions){
  const rows=transactions.filter(t=>!t.pending&&t.currency==='CAD');
  const income=rows.filter(t=>t.kind==='income').reduce((s,t)=>s-Math.round(t.amount*100),0)/100;
  const spending=rows.filter(t=>['expense','refund'].includes(t.kind)).reduce((s,t)=>s+Math.round(t.amount*100),0)/100;
  const payments=rows.filter(t=>t.kind==='credit_payment').reduce((s,t)=>s+Math.round(Math.abs(t.amount)*100),0)/100;
  const refunds=rows.filter(t=>t.kind==='refund').reduce((s,t)=>s+Math.round(Math.abs(t.amount)*100),0)/100;
  return {income,spending,payments,refunds,surplus:Math.round((income-spending)*100)/100,savingsRate:income>0?(income-spending)/income*100:null};
}

export function exponentiallyWeightedAverage(values,weight=.35){
  const clean=values.map(Number).filter(Number.isFinite);
  if(!clean.length)return 0;
  return clean.slice(1).reduce((average,value)=>weight*value+(1-weight)*average,clean[0]);
}

export function applyChanges(existing,pages){
  const result=new Map(existing.map(t=>[t.transaction_id,t]));
  for(const page of pages){for(const t of [...page.added,...page.modified])result.set(t.transaction_id,t);for(const t of page.removed)result.delete(t.transaction_id);}
  return [...result.values()];
}

export function demoData(){
  const accounts=[{id:'scotia',name:'Everyday chequing',institution:'Scotiabank',type:'depository',subtype:'checking',class:'cash',mask:'4821',balance:8240.50,available:7900,limit:null,currency:'CAD'},{id:'rbc',name:'High interest savings',institution:'RBC',type:'depository',subtype:'savings',class:'cash',mask:'0916',balance:18750,available:18750,limit:null,currency:'CAD'},{id:'amex',name:'Cobalt card',institution:'American Express',type:'credit',subtype:'credit card',class:'credit_card',mask:'1008',balance:1248.36,available:8751.64,limit:10000,currency:'CAD'}];
  const transactions=[],now=new Date();
  const push=(month,day,name,amount,category,kind,accountId)=>{const d=new Date(now.getFullYear(),now.getMonth()-month,day,12);if(d>now)return;const a=accounts.find(x=>x.id===accountId);transactions.push({id:`demo-${transactions.length}`,accountId,date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,name,amount,currency:'CAD',category,kind,pending:false,review:false,institution:a.institution,accountName:a.name,accountType:a.type,accountSubtype:a.subtype,accountClass:a.class});};
  for(let m=23;m>=0;m--){
    push(m,1,'Payroll deposit',-3200,'Income','income','scotia');push(m,15,'Payroll deposit',-3200,'Income','income','scotia');push(m,2,'Monthly rent',1850,'Home & bills','expense','scotia');push(m,4,'Internet',65,'Home & bills','expense','scotia');push(m,6,'Spotify',12.99,'Entertainment','expense','amex');push(m,12,'Netflix',20.99,'Entertainment','expense','amex');push(m,20,'Hydro',84+m%5*3,'Home & bills','expense','scotia');push(m,18,'Savings transfer',800,'Transfers','transfer','scotia');push(m,18,'Savings transfer',-800,'Transfers','transfer','rbc');push(m,22,'Amex payment',1100,'Credit card payments','transfer','scotia');push(m,23,'PAYMENT RECEIVED - THANK YOU',-1100,'Credit card payments','credit_payment','amex');
    for(let d=3;d<=27;d+=4){push(m,d,'Farm Boy',Math.round((76+((d*7+m*13)%55))*100)/100,'Groceries','expense','amex');push(m,d+1,['Pilot Coffee','Freshii','Local restaurant'][d%3],18+(d*3+m*9)%68,'Food & dining','expense','amex');}
    push(m,10,'PRESTO',108,'Transport','expense','amex');push(m,24,'Indigo',62+m%6*14,'Shopping','expense','amex');if(m%4===0)push(m,26,'Indigo refund',-62,'Refunds','refund','amex');
  }
  return {accounts,transactions:transactions.sort((a,b)=>b.date.localeCompare(a.date)),connections:[],demo:true};
}
