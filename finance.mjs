const paymentWords=/\b(PAYMENT RECEIVED|THANK YOU|AUTOPAY|CARD PAYMENT|CREDIT CARD PAYMENT|PAYMENT -? THANK|PAYMENT THANK)\b/i;
const outgoingCardPaymentWords=/\b(?:BILL PAYMENT.*(?:BANK|VISA|MASTERCARD|MASTER CARD|AMEX|AMERICAN EXPRESS|CAPITAL ONE)|(?:VISA|MASTERCARD|MASTER CARD|AMEX|AMERICAN EXPRESS) PAYMENT)\b/i;
const refundWords=/\b(REFUND|RETURN|REVERSAL|CREDIT MEMO|MERCHANT CREDIT|PRICE ADJUSTMENT|CASHBACK)\b/i;
const interacDeposit=/\bDEPOSIT.*INTERAC E-?TRANSFER\b/i;
const rentWords=/\b(?:SIGNET(?: GROUP| MANAGEMENT)?|RENT PAYMENT|MONTHLY RENT)\b/i;
const labels={FOOD_AND_DRINK:'Food & dining',GENERAL_MERCHANDISE:'Shopping',RENT_AND_UTILITIES:'Home & bills',TRANSPORTATION:'Transport',ENTERTAINMENT:'Entertainment',GENERAL_SERVICES:'Services',TRAVEL:'Travel',MEDICAL:'Health',PERSONAL_CARE:'Personal care',BANK_FEES:'Bank fees',LOAN_PAYMENTS:'Loan payments',INCOME:'Income',GOVERNMENT_AND_NON_PROFIT:'Government & giving',HOME_IMPROVEMENT:'Home improvement',UNCATEGORIZED:'Needs review'};

export const isRentPayment=transaction=>transaction?.kind==='expense'&&(transaction?.category==='Rent'||rentWords.test(transaction?.name||''));

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
  const rent=kind==='expense'&&rentWords.test(name),baseCategory=rent?'Rent':detail.includes('GROCERIES')?'Groceries':labels[primary]||primary.replaceAll('_',' ').toLowerCase();
  const category=cardPayment?'Credit card payments':plaidTransfer?'Transfers':kind==='refund'&&refundWords.test(name)?'Refunds':baseCategory;
  const confidence=p.confidence_level||null,ambiguousCredit=credit&&t.amount<0&&!cardPayment&&!refundWords.test(name);
  return {id:t.transaction_id,accountId:t.account_id,date:t.date,name,amount:t.amount,currency:t.iso_currency_code||t.unofficial_currency_code||'Unknown',pending:!!t.pending,category,kind,institution,accountName:account.name||'',accountType:account.type||'',accountSubtype:account.subtype||'',accountClass:classification,review:rent||cardPayment?false:ambiguousCredit||!p.primary||!['HIGH','VERY_HIGH'].includes(confidence),classificationReason:rent?'known rent merchant':cardPayment?'credit-account payment description':plaidTransfer?'Plaid transfer category':income?'Plaid income category':kind==='refund'?(refundWords.test(name)?'refund description':'credit or negative transaction'):'Plaid spending category'};
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
  const contributionCandidates=rows.filter(t=>t.kind==='transfer'&&t.amount<0&&t.currency==='CAD'&&/preferred package/i.test(t.accountName)&&interacDeposit.test(t.name)&&Math.abs(t.amount)>=500&&Math.abs(t.amount)<=700&&Number(t.date.slice(8,10))<=12);
  const contributionMonths=new Map();
  for(const row of contributionCandidates){const month=row.date.slice(0,7),group=contributionMonths.get(month)||[];group.push(row);contributionMonths.set(month,group);}
  if(contributionMonths.size>=4)for(const group of contributionMonths.values()){
    const row=group.sort((a,b)=>a.date.localeCompare(b.date)||Math.abs(Math.abs(a.amount)-600)-Math.abs(Math.abs(b.amount)-600))[0];
    row.kind='contribution';row.category='Household contribution';row.review=false;row.classificationReason='recurring monthly household contribution';
  }
  const genericReimbursements=rows.filter(t=>t.kind==='transfer'&&t.amount<0&&t.currency==='CAD'&&interacDeposit.test(t.name));
  const largeExpenses=rows.filter(t=>t.kind==='expense'&&!t.pending&&t.currency==='CAD'&&t.amount>=2000).sort((a,b)=>a.date.localeCompare(b.date));
  for(const expense of largeExpenses){
    const maximum=expense.amount*1.025,candidates=genericReimbursements.filter(t=>!t.reimbursedExpenseId&&t.date>=expense.date&&dayDistance(t.date,expense.date)<=60).sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount)),selected=[];
    let total=0;
    for(const candidate of candidates){const value=Math.abs(candidate.amount);if(total+value<=maximum){selected.push(candidate);total+=value;}}
    if(selected.length&&total>=expense.amount*.975&&selected.some(t=>Math.abs(t.amount)>=expense.amount*.25)){
      expense.originalCategory=expense.category;expense.kind='reimbursed_expense';expense.category='Reimbursed pass-through';expense.review=false;expense.classificationReason='large purchase matched to later e-transfer reimbursements';expense.reimbursementTotal=Math.round(total*100)/100;
      for(const row of selected){row.kind='reimbursement';row.category='Reimbursed pass-through';row.review=false;row.reimbursedExpenseId=expense.id;row.classificationReason='matched to reimbursed purchase';}
    }
  }
  return rows;
}

export function summarize(transactions){
  const rows=transactions.filter(t=>!t.pending&&t.currency==='CAD');
  const earnedIncome=rows.filter(t=>t.kind==='income').reduce((s,t)=>s-Math.round(t.amount*100),0)/100;
  const contributions=rows.filter(t=>t.kind==='contribution').reduce((s,t)=>s-Math.round(t.amount*100),0)/100;
  const income=Math.round((earnedIncome+contributions)*100)/100;
  const spending=rows.filter(t=>['expense','refund'].includes(t.kind)).reduce((s,t)=>s+Math.round(t.amount*100),0)/100;
  const payments=rows.filter(t=>t.kind==='credit_payment').reduce((s,t)=>s+Math.round(Math.abs(t.amount)*100),0)/100;
  const refunds=rows.filter(t=>t.kind==='refund').reduce((s,t)=>s+Math.round(Math.abs(t.amount)*100),0)/100;
  const reimbursements=rows.filter(t=>t.kind==='reimbursement').reduce((s,t)=>s+Math.round(Math.abs(t.amount)*100),0)/100;
  const passThrough=rows.filter(t=>t.kind==='reimbursed_expense').reduce((s,t)=>s+Math.round(Math.abs(t.amount)*100),0)/100;
  return {income,earnedIncome,contributions,spending,payments,refunds,reimbursements,passThrough,surplus:Math.round((income-spending)*100)/100,savingsRate:income>0?(income-spending)/income*100:null};
}

export function exponentiallyWeightedAverage(values,weight=.35){
  const clean=values.map(Number).filter(Number.isFinite);
  if(!clean.length)return 0;
  return clean.slice(1).reduce((average,value)=>weight*value+(1-weight)*average,clean[0]);
}

export function robustWeightedAverage(values,weight=.35){
  const clean=values.map(Number).filter(Number.isFinite);
  if(!clean.length)return 0;
  const sorted=[...clean].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2),median=sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2,deviations=clean.map(value=>Math.abs(value-median)).sort((a,b)=>a-b),dMiddle=Math.floor(deviations.length/2),mad=deviations.length%2?deviations[dMiddle]:(deviations[dMiddle-1]+deviations[dMiddle])/2,scale=mad*1.4826,lower=Math.max(0,scale?median-2.5*scale:median*.5),upper=scale?median+2.5*scale:median*1.5;
  return exponentiallyWeightedAverage(clean.map(value=>Math.min(upper,Math.max(lower,value))),weight);
}

export function applyChanges(existing,pages){
  const result=new Map(existing.map(t=>[t.transaction_id,t]));
  for(const page of pages){for(const t of [...page.added,...page.modified])result.set(t.transaction_id,t);for(const t of page.removed)result.delete(t.transaction_id);}
  return [...result.values()];
}

export function demoData(){
  // Deterministic sample workspace, generated relative to today so it always looks current.
  const now=new Date(),TODAY=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
  let seed=20261103;const rnd=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};
  const R=(a,b)=>Math.round((a+rnd()*(b-a))*100)/100,pick=a=>a[Math.floor(rnd()*a.length)],N=(a,b)=>a+Math.floor(rnd()*(b-a+1));
  const pad=n=>String(n).padStart(2,'0'),iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const accounts=[
   {id:'sc-chq',institution:'Scotiabank',name:'Ultimate Chequing',officialName:'',mask:'4821',type:'depository',subtype:'checking',class:'cash',balance:6842.17,available:6842.17,limit:null,currency:'CAD'},
   {id:'sc-sav',institution:'Scotiabank',name:'MomentumPLUS Savings',officialName:'',mask:'1190',type:'depository',subtype:'savings',class:'cash',balance:14250,available:14250,limit:null,currency:'CAD'},
   {id:'rbc-avion',institution:'RBC',name:'Avion Visa Infinite',officialName:'',mask:'7732',type:'credit',subtype:'credit card',class:'credit_card',balance:1284.55,available:8715.45,limit:10000,currency:'CAD'},
   {id:'amex',institution:'American Express',name:'Cobalt Card',officialName:'',mask:'1008',type:'credit',subtype:'credit card',class:'credit_card',balance:742.30,available:7257.70,limit:8000,currency:'CAD'},
   {id:'honda',institution:'RBC',name:'Honda Finance auto loan',officialName:'',mask:'5530',type:'loan',subtype:'auto',class:'loan',balance:14620,available:null,limit:null,currency:'CAD'}
  ];
  const acct=Object.fromEntries(accounts.map(a=>[a.id,a])),transactions=[];
  const add=(date,name,amount,category,accountId,kind='expense')=>{if(date>TODAY)return;const a=acct[accountId];transactions.push({id:`demo-${transactions.length+1}`,accountId,date:iso(date),name,amount:Math.round(amount*100)/100,currency:'CAD',category,kind,pending:false,review:false,institution:a.institution,accountName:a.name,accountType:a.type,accountSubtype:a.subtype,accountClass:a.class});};
  // [name, amount, day, category, account, first month (months ago)]
  const subs=[['NETFLIX.COM',20.99,5,'Entertainment','amex',24],['SPOTIFY P1',11.99,9,'Entertainment','amex',24],['APPLE.COM/BILL ICLOUD',3.99,12,'Services','rbc-avion',24],['ADOBE CREATIVE CLOUD',29.99,18,'Services','rbc-avion',20],['GOODLIFE FITNESS',64.99,1,'Personal care','rbc-avion',24],['ROGERS WIRELESS',95,22,'Home & bills','rbc-avion',24],['TD INSURANCE AUTO',168.40,28,'Home & bills','sc-chq',24],['CRAVE',22.59,14,'Entertainment','amex',5]];
  for(let i=24;i>=0;i--){
   const base=new Date(TODAY.getFullYear(),TODAY.getMonth()-i,1,12),y=base.getFullYear(),m=base.getMonth(),dim=new Date(y,m+1,0).getDate(),D=d=>new Date(y,m,Math.min(d,dim),12),pay=i<=10?3120:2950;
   add(D(1),'ACME CORP PAYROLL',-pay,'Income','sc-chq','income');add(D(15),'ACME CORP PAYROLL',-pay,'Income','sc-chq','income');
   add(D(1),'SIGNET PROPERTIES RENT',i<=14?2225:2150,'Rent','sc-chq');
   add(D(15),'HONDA FINANCE',486,'Loan payments','sc-chq');
   add(D(2),'TRANSFER TO SAVINGS',600,'Transfers','sc-chq','transfer');
   for(const [n,a,d,c,ac,since] of subs)if(i<=since)add(D(d),n,n==='SPOTIFY P1'&&i<=13?12.99:n==='NETFLIX.COM'&&i<=7?23.99:a,c,ac);
   if(i<=4)add(D(3),'OPENAI CHATGPT PLUS',28,'Services','rbc-avion');if(i<=3)add(D(7),'DISNEY PLUS',14.99,'Entertainment','amex');
   add(D(20),'TORONTO HYDRO',R(68,[0,1,6,7,11].includes(m)?142:96),'Home & bills','sc-chq');
   if(rnd()<.45)add(D(3),'SCOTIABANK MONTHLY FEE',16.95,'Bank fees','sc-chq');
   const season=m===11?1.35:m===10?1.12:1;
   for(let k=0,n=N(5,7);k<n;k++){const s=pick(['LOBLAWS','FARM BOY','COSTCO WHOLESALE','NO FRILLS','LOBLAWS']);add(D(N(1,dim)),s,R(s.startsWith('COSTCO')?120:38,s.startsWith('COSTCO')?260:135)*season,'Groceries',pick(['amex','amex','rbc-avion']));}
   for(let k=0,n=N(9,15);k<n;k++){const s=pick(['UBER EATS','STARBUCKS','PIZZERIA LIBRETTO','TIM HORTONS','PAI NORTHERN THAI','UBER EATS','STARBUCKS']),rg={'UBER EATS':[22,62],'STARBUCKS':[5,9],'PIZZERIA LIBRETTO':[42,96],'TIM HORTONS':[3,12],'PAI NORTHERN THAI':[48,118]}[s];add(D(N(1,dim)),s,R(...rg)*(m===11?1.2:1),'Food & dining','amex');}
   for(let k=0,n=N(2,3);k<n;k++)add(D(N(1,dim)),'PETRO-CANADA',R(48,88),'Transport','rbc-avion');
   add(D(N(1,10)),'PRESTO TRANSIT',R(40,120),'Transport','rbc-avion');for(let k=0,n=N(0,3);k<n;k++)add(D(N(1,dim)),'UBER TRIP',R(12,42),'Transport','amex');
   for(let k=0,n=N(2,4);k<n;k++)add(D(N(1,dim)),'AMAZON.CA',R(14,145)*season,'Shopping',pick(['rbc-avion','amex']));
   if(rnd()<.35)add(D(N(1,dim)),'UNIQLO TORONTO',R(45,160),'Shopping','rbc-avion');
   if(m===10||m===11||rnd()<.08)add(D(N(5,dim)),'BEST BUY',R(220,780),'Shopping','rbc-avion');
   for(let k=0,n=N(1,2);k<n;k++)add(D(N(1,dim)),'SHOPPERS DRUG MART',R(14,62),'Personal care','rbc-avion');
   if(i===16||i===5){add(D(4),'AIR CANADA',i===16?684.2:812.6,'Travel','rbc-avion');add(D(5),'AIRBNB',i===16?540:695,'Travel','rbc-avion');}
   if(rnd()<.2)add(D(N(1,dim)),'AMAZON.CA REFUND',-R(20,90),'Shopping','rbc-avion','refund');
   add(D(26),'PAYMENT - THANK YOU',-R(1400,2600),'Credit card payments','rbc-avion','credit_payment');add(D(27),'AMEX PAYMENT RECEIVED',-R(700,1300),'Credit card payments','amex','credit_payment');
  }
  // A one-off charge in the last few weeks that may turn into a subscription.
  const recent=new Date(TODAY);recent.setDate(recent.getDate()-12);add(recent,'AUDIBLE CA',14.95,'Entertainment','amex');
  transactions.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  const cut=new Date(TODAY);cut.setDate(cut.getDate()-5);transactions.filter(t=>t.date>=iso(cut)&&t.kind==='expense').slice(0,2).forEach(t=>t.pending=true);
  return {accounts,transactions,connections:[],demo:true};
}
