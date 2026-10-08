export function normalize(t, institution = '') {
  const p = t.personal_finance_category || {};
  const primary = p.primary || 'UNCATEGORIZED';
  const detail = p.detailed || '';
  const transfer = primary.startsWith('TRANSFER') || /CREDIT_CARD_PAYMENT/.test(detail);
  const income = primary === 'INCOME';
  const kind = transfer ? 'transfer' : income ? 'income' : t.amount < 0 ? 'refund' : 'expense';
  const labels = {FOOD_AND_DRINK:'Food & dining', GENERAL_MERCHANDISE:'Shopping', RENT_AND_UTILITIES:'Home & bills', TRANSPORTATION:'Transport', ENTERTAINMENT:'Entertainment', GENERAL_SERVICES:'Services', TRAVEL:'Travel', MEDICAL:'Health', PERSONAL_CARE:'Personal care', BANK_FEES:'Bank fees', LOAN_PAYMENTS:'Loan payments', INCOME:'Income', UNCATEGORIZED:'Needs review'};
  return {id:t.transaction_id, accountId:t.account_id, date:t.date, name:t.merchant_name || t.name || 'Unknown merchant', amount:t.amount, currency:t.iso_currency_code || t.unofficial_currency_code || 'Unknown', pending:!!t.pending, category:transfer?'Transfers':detail.includes('GROCERIES')?'Groceries':labels[primary] || primary.replaceAll('_',' ').toLowerCase(), kind, institution, review:!p.primary || !['HIGH','VERY_HIGH'].includes(p.confidence_level)};
}
export function summarize(transactions) {
  const rows = transactions.filter(t=>!t.pending && t.currency==='CAD');
  const income = rows.filter(t=>t.kind==='income').reduce((s,t)=>s-Math.round(t.amount*100),0)/100;
  const spending = rows.filter(t=>['expense','refund'].includes(t.kind)).reduce((s,t)=>s+Math.round(t.amount*100),0)/100;
  return {income,spending,surplus:Math.round((income-spending)*100)/100,savingsRate:income>0?(income-spending)/income*100:null};
}
export function applyChanges(existing, pages) {
  const result = new Map(existing.map(t=>[t.transaction_id,t]));
  for (const page of pages) {
    for(const t of [...page.added,...page.modified]) result.set(t.transaction_id,t);
    for(const t of page.removed) result.delete(t.transaction_id);
  }
  return [...result.values()];
}
export function demoData() {
  const accounts = [
    {id:'scotia',name:'Everyday chequing',institution:'Scotiabank',type:'depository',mask:'4821',balance:8240.50,currency:'CAD'},
    {id:'rbc',name:'High interest savings',institution:'RBC',type:'depository',mask:'0916',balance:18750,currency:'CAD'},
    {id:'amex',name:'Cobalt card',institution:'American Express',type:'credit',mask:'1008',balance:1248.36,currency:'CAD'}
  ];
  const transactions=[]; const now=new Date();
  const push=(month,day,name,amount,category,kind,accountId)=>{
    const d=new Date(now.getFullYear(),now.getMonth()-month,day,12);
    if(d>now)return;
    transactions.push({id:`demo-${transactions.length}`,accountId,date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,name,amount,currency:'CAD',category,kind,pending:false,review:false,institution:accounts.find(a=>a.id===accountId).institution});
  };
  for(let m=5;m>=0;m--){
    push(m,1,'Payroll deposit',-3200,'Income','income','scotia');push(m,15,'Payroll deposit',-3200,'Income','income','scotia');
    push(m,2,'Monthly rent',1850,'Home & bills','expense','scotia');
    push(m,4,'Internet',65,'Home & bills','expense','scotia');
    push(m,6,'Spotify',12.99,'Entertainment','expense','amex');
    push(m,12,'Netflix',20.99,'Entertainment','expense','amex');
    push(m,20,'Hydro',84+m*3,'Home & bills','expense','scotia');
    push(m,18,'Savings transfer',800,'Transfers','transfer','scotia');push(m,18,'Savings transfer',-800,'Transfers','transfer','rbc');
    push(m,22,'Amex payment',1100,'Transfers','transfer','scotia');push(m,22,'Card payment received',-1100,'Transfers','transfer','amex');
    for(let d=3;d<=27;d+=4){push(m,d,'Farm Boy',Math.round((76+((d*7+m*13)%55))*100)/100,'Groceries','expense','amex');push(m,d+1,['Pilot Coffee','Freshii','Local restaurant'][d%3],18+(d*3+m*9)%68,'Food & dining','expense','amex');}
    push(m,10,'PRESTO',108,'Transport','expense','amex');push(m,24,'Indigo',62+m*14,'Shopping','expense','amex');
  }
  return {accounts,transactions:transactions.sort((a,b)=>b.date.localeCompare(a.date)),connections:[],demo:true};
}
