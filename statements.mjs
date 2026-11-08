// Bank statement import: turns a PDF statement into Plaid-shaped account + transaction records
// so imported data flows through the same classification and analysis as connected banks.
// Statements are only accepted when their transactions reconcile with the statement totals.
import {createHash} from 'node:crypto';

const MONTHS={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
const pad=n=>String(n).padStart(2,'0');
const cents=s=>{const neg=/^-/.test(s.trim())||/^\(.*\)$/.test(s.trim());const v=Math.round(Number(String(s).replace(/[^0-9.]/g,''))*100);return neg?-v:v;};
const MONEY='-?\\$[\\d,]+\\.\\d{2}';

// Reconstruct visual text rows from a PDF (items on the same baseline, left to right).
export async function pdfRows(buffer){
 const {getDocumentProxy}=await import('unpdf');
 const pdf=await getDocumentProxy(new Uint8Array(buffer));
 const rows=[];
 for(let p=1;p<=pdf.numPages;p++){
  const page=await pdf.getPage(p),tc=await page.getTextContent(),byY=[];
  for(const it of tc.items){const s=(it.str||'').trim();if(!s)continue;const x=it.transform[4],y=it.transform[5];let row=byY.find(r=>Math.abs(r.y-y)<=2.5);if(!row){row={y,items:[]};byY.push(row);}row.items.push({x,s});}
  byY.sort((a,b)=>b.y-a.y);
  for(const r of byY)rows.push({page:p,y:r.y,items:r.items.sort((a,b)=>a.x-b.x),text:r.items.sort((a,b)=>a.x-b.x).map(i=>i.s).join('  ')});
 }
 return rows;
}

export function detectFormat(rows){
 const head=rows.slice(0,40).map(r=>r.text).join('\n');
 if(/STATEMENT FROM [A-Z]{3} \d{1,2}/.test(head)&&/Visa|Mastercard|RBC/i.test(head)&&/\d{4} \d{2}\*\* \*{4} \d{4}/.test(head))return 'rbc-credit-card';
 return null;
}

// RBC credit card statements (Visa / Mastercard): "MON DD  MON DD  DESCRIPTION  $AMOUNT".
export function parseRbcCreditCard(rows){
 const all=rows.map(r=>r.text);
 const period=all.map(t=>t.match(/STATEMENT FROM ([A-Z]{3}) (\d{1,2})(?:, (\d{4}))? TO ([A-Z]{3}) (\d{1,2}), (\d{4})/)).find(Boolean);
 if(!period)throw new StatementError('STATEMENT_PERIOD_NOT_FOUND','Could not find the statement period.');
 const endYear=+period[6],endMonth=MONTHS[period[4]],startMonth=MONTHS[period[1]],startYear=period[3]?+period[3]:(startMonth>endMonth?endYear-1:endYear);
 const iso=(y,m,d)=>`${y}-${pad(m+1)}-${pad(d)}`;
 const yearFor=m=>m>endMonth?endYear-1:endYear;
 const card=all.map(t=>t.match(/(\d{4}) (\d{2})\*\* \*{4} (\d{4})/)).find(Boolean);
 // Product name from the title line only (left column), ignoring marketing text beside it.
 const titleRow=rows.find(r=>/^RBC\b/.test(r.items[0]?.s||'')&&/(Visa|Mastercard)/i.test(r.items.filter(i=>i.x<300).map(i=>i.s).join(' ')));
 const productText=titleRow?titleRow.items.filter(i=>i.x<300).map(i=>i.s).join(' '):'RBC credit card';
 const product=((productText.match(/RBC.*?(?:Visa|Mastercard)/i)||[productText])[0]).replace(/TM|‡|®/g,' ').replace(/\s+\+/g,'+').replace(/\s+/g,' ').trim();
 const findMoney=re=>{for(const t of all){const m=t.match(re);if(m)return cents(m[1]);}return null;};
 const previous=findMoney(new RegExp(`PREVIOUS (?:ACCOUNT |STATEMENT )?BALANCE\\s+(${MONEY})`,'i'));
 const total=findMoney(new RegExp(`Total Account Balance\\s+(${MONEY})`,'i'))??findMoney(new RegExp(`(?:NEW BALANCE|CREDIT BALANCE)\\s+(${MONEY})`));
 const limit=findMoney(new RegExp(`Credit limit\\s+(${MONEY})`,'i'));
 if(previous==null||total==null)throw new StatementError('STATEMENT_TOTALS_NOT_FOUND','Could not find the opening and closing balances.');
 const txRe=new RegExp(`^([A-Z]{3}) (\\d{2})\\s+([A-Z]{3}) (\\d{2})\\s+(.+?)\\s+(${MONEY})(?:\\s|$)`);
 const tx=[];let last=null;
 for(const r of rows){
  const t=r.text,m=t.match(txRe);
  if(m&&MONTHS[m[1]]!=null&&MONTHS[m[3]]!=null){
   const tm=MONTHS[m[1]],pm=MONTHS[m[3]];
   last={date:iso(yearFor(tm),tm,+m[2]),posted:iso(yearFor(pm),pm,+m[4]),name:m[5].replace(/\s{2,}/g,' ').trim(),cents:cents(m[6]),ref:null,note:null,page:r.page};
   tx.push(last);continue;
  }
  if(!last)continue;
  const first=r.items[0];
  const ref=t.match(/^(\d{20,26})\b/);if(ref&&!last.ref&&first&&first.x>80){last.ref=ref[1];continue;}
  const fx=t.match(/^Foreign Currency - ([A-Z]{3}) ([\d,.]+) Exchange rate - ([\d.]+)/);if(fx){last.note=`${fx[1]} ${fx[2]} @ ${fx[3]}`;continue;}
 }
 const sum=tx.reduce((s,t)=>s+t.cents,0),diff=previous+sum-total;
 const last4=card?.[3]||'0000',seen=new Map();
 const transactions=tx.map((t,i)=>{
  const base=t.ref?`rbc-${last4}-${t.ref}`:`rbc-${last4}-${createHash('sha256').update(`${t.date}|${t.posted}|${t.name}|${t.cents}`).digest('hex').slice(0,16)}`;
  const n=(seen.get(base)||0)+1;seen.set(base,n);
  return {id:n>1?`${base}-${n}`:base,date:t.date,posted:t.posted,name:t.name,amount:t.cents/100,note:t.note};
 });
 // Reissued cards keep the account: group by card prefix + product, show the newest last four digits.
 const productKey=product.toLowerCase().replace(/[^a-z]+/g,'-').replace(/^-|-$/g,'');
 return {format:'rbc-credit-card',institution:'RBC',account:{key:`rbc-cc-${card?.[1]||'0000'}${card?.[2]||''}-${productKey}`,name:product,mask:last4,type:'credit',subtype:'credit card',limit:limit==null?null:limit/100},
  period:{start:iso(startYear,startMonth,+period[2]),end:iso(endYear,endMonth,+period[5])},previous:previous/100,total:total/100,transactions,reconciled:diff===0,difference:diff/100};
}

export class StatementError extends Error{constructor(code,message){super(message);this.code=code;}}

export async function parseStatement(buffer){
 const rows=await pdfRows(buffer),format=detectFormat(rows);
 if(format==='rbc-credit-card')return parseRbcCreditCard(rows);
 throw new StatementError('UNSUPPORTED_STATEMENT','This doesn’t look like an RBC credit card statement. Only RBC credit card PDFs are supported for now.');
}

// ---- Categories for statement transactions (no bank-provided category) ----
const KEYWORDS=[
 ['LOAN_PAYMENTS','LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',/\bPAYMENT\b.*\bTHANK YOU\b|\bPAIEMENT\b/],
 ['BANK_FEES','BANK_FEES_INTEREST_CHARGE',/\b(?:PURCHASE|CASH ADVANCE|BALANCE TRANSFER) INTEREST\b|^INTEREST\b/],
 ['BANK_FEES','BANK_FEES_OTHER_BANK_FEES',/\b(?:ANNUAL FEE|OVERLIMIT FEE|LATE PAYMENT FEE|NSF FEE|CASH ADVANCE FEE|FOREIGN TRANSACTION FEE)\b/],
 ['FOOD_AND_DRINK','FOOD_AND_DRINK_GROCERIES',/\b(?:NO FRILLS|LOBLAWS|FRESHCO|FOOD BASICS|SOBEYS|METRO\b|FARM BOY|COSTCO|T ?& ?T SUPERMARKET|ADONIS|WHOLE FOODS|SUPERSTORE|LONGO|WALMART SUPERCENTER|WAL-MART SUPERCENTER|IQBAL FOODS|GROCERY|SUPERMAR|FOOD CENTRE|MILK\b|INDIA FOOD|BAZAAR|NOFRILLS|PANDA MART|FOOD MART|FRUITS?\b)/],
 ['FOOD_AND_DRINK','FOOD_AND_DRINK_COFFEE',/\b(?:TIM HORTONS|STARBUCKS|SECOND CUP|BALZAC|COFFEE|CAFE|TEA\b|TEA-|CHATIME)/],
 ['FOOD_AND_DRINK','FOOD_AND_DRINK_FAST_FOOD',/(?:MCDONALD|TACO BELL|BURGER|WENDY|A&W|\bKFC|SUBWAY|POPEYES|PIZZA|DOMINO|BURRITO|CHIPOTLE|FRESHII|HARVEY|DAIRY QUEEN|SWISS CHALET|HUNGERHUB)/],
 ['FOOD_AND_DRINK','FOOD_AND_DRINK_RESTAURANT',/\b(?:UBER ?\*? ?EATS|DOORDASH|SKIP ?THE ?DISHES|RITUAL|RESTAURANT|REST\b|RESTT|SWEETS|DHOKLA|GRILL|KITCHEN|BISTRO|SUSHI|THAI\b|THAL\b|SHAWARMA|BIRYANI|DINER|BAR\b|PUB\b|BAKERY|CHILI'?S|PURE VEG|DESSERT|\bINN\b|ANNALAKSHMI|ISHQ\b|AUNTIE EMM)/],
 ['TRANSPORTATION','TRANSPORTATION_GAS',/\b(?:SHELL|ESSO|PETRO-?CANADA|PIONEER|ULTRAMAR|HUSKY|GAS STATION|CIRCLE K)\b/],
 ['TRANSPORTATION','TRANSPORTATION_PARKING',/\b(?:SPOTHERO|GREEN ?P\b|IMPARK|PRECISE PARK|INDIGO PARK|PARKING|HONK)\b/],
 ['TRANSPORTATION','TRANSPORTATION_PUBLIC_TRANSIT',/\b(?:PRESTO|TTC|GO TRANSIT|UP EXPRESS|VIA RAIL|BIKE SHARE)\b/],
 ['TRANSPORTATION','TRANSPORTATION_TAXIS_AND_RIDE_SHARES',/\b(?:UBER(?! ?\*? ?EATS)|UBERBV|LYFT|BECK TAXI|BIRD\*|SCOOTER|LIME\*)/],
 ['TRAVEL','TRAVEL_FLIGHTS',/\b(?:AIR CANADA|AIR CAN\*|ETIHAD|EMIRATES|INFLYT|AIRW|WESTJET|PORTER AIR|FLAIR|AIR TRANSAT|EXPEDIA|BOOKING\.COM|AIRBNB|HOTEL|MARRIOTT|HILTON|TRAVEL GUARD)/],
 ['ENTERTAINMENT','ENTERTAINMENT_TV_AND_MOVIES',/\b(?:OLG\b|POKERSTARS|STARS \d|NETFLIX|SPOTIFY|DISNEY|CRAVE|PRIME VIDEO|CINEPLEX|YOUTUBE|APPLE\.COM\/BILL|STEAM|PLAYSTATION|XBOX|NINTENDO|AUDIBLE|SNIFFIES)/],
 ['GENERAL_SERVICES','GENERAL_SERVICES_OTHER_GENERAL_SERVICES',/\b(?:AMAZON WEB SERVICES|AWS\b|EXPRESSVPN|OPENAI|ALLCASTING|INTCH|CHATGPT|ADOBE|MICROSOFT|GOOGLE|DROPBOX|GITHUB|NOTION|CANVA|COOKIEBOT|ICLOUD|SPARKLE SOLUTIONS|LAUNDRY|DRY CLEAN)/],
 ['GENERAL_SERVICES','GENERAL_SERVICES_INSURANCE',/\bINSURANCE\b|TRAVEL GUARD/],
 ['RENT_AND_UTILITIES','RENT_AND_UTILITIES_TELEPHONE',/\b(?:ROGERS|BELL CANADA|BELL MOBILITY|TELUS|FIDO|KOODO|VIRGIN|FREEDOM MOBILE|PUBLIC MOBILE|CHATR)\b/],
 ['RENT_AND_UTILITIES','RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',/\b(?:HYDRO|ENBRIDGE|ALECTRA|TORONTO WATER)\b/],
 ['PERSONAL_CARE','PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS',/\b(?:FITNESS|GOODLIFE|GYM\b|YOGA|BARBER|SALON|SPA\b)/],
 ['MEDICAL','MEDICAL_PHARMACIES_AND_SUPPLEMENTS',/\b(?:SHOPPERS DRUG|REXALL|PHARMA|DRUG MART|DENTAL|CLINIC|OPTICAL)/],
 ['GOVERNMENT_AND_NON_PROFIT','GOVERNMENT_AND_NON_PROFIT_DONATIONS',/\b(?:DONATION|CHARITY|FOUNDATION|CHILDRENS? VIL|IMMIGRATION CANADA|BUSINESS NAME REG|PUBLIC LIBRARY|EMBASSY|PASSPORT|RED CROSS|UNICEF|SERVICEONTARIO|CRA\b|CITY OF)/],
 ['HOME_IMPROVEMENT','HOME_IMPROVEMENT_HARDWARE',/\b(?:HOME DEPOT|RONA|LOWE'?S|HM HWRE|HARDWARE|CANADIAN TIRE)\b/],
 ['GENERAL_MERCHANDISE','GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',/\b(?:AMAZON|AMZN|WAL-?MART|BEST BUY|DOLLARAMA|IKEA|WINNERS|MARSHALLS|UNIQLO|H&M|ZARA|INDIGO|STAPLES|APPLE STORE|CONVENIENCE|SHOPPERS|EBAY|ETSY|TEMU|URBAN PLANET|URBAN BEHAVIOR|AMAZON\.CA PRIME)/]
];
export const merchantWords=name=>String(name||'').toUpperCase().replace(/[^A-Z& ]+/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(w=>w.length>1).slice(0,2).join(' ');
export function categorize(name,learned=new Map()){
 const upper=String(name||'').toUpperCase(),hit=KEYWORDS.find(([,,re])=>re.test(upper));
 if(hit&&['LOAN_PAYMENTS','BANK_FEES'].includes(hit[0]))return {primary:hit[0],detailed:hit[1],confidence_level:'HIGH'};
 const known=learned.get(merchantWords(name));if(known)return {...known,confidence_level:'HIGH'};
 if(hit)return {primary:hit[0],detailed:hit[1],confidence_level:'HIGH'};
 return {primary:'UNCATEGORIZED',detailed:'',confidence_level:'LOW'};
}
// Merchant → category map learned from bank-categorized (Plaid) transactions.
export function learnCategories(rawTransactions){
 const votes=new Map();
 for(const t of rawTransactions){const p=t.personal_finance_category;if(!p?.primary||!['HIGH','VERY_HIGH'].includes(p.confidence_level)||/^(TRANSFER|INCOME|LOAN_PAYMENTS)/.test(p.primary))continue;const k=merchantWords(t.merchant_name||t.name);if(!k)continue;const m=votes.get(k)||new Map(),key=`${p.primary}|${p.detailed||''}`;m.set(key,(m.get(key)||0)+1);votes.set(k,m);}
 const out=new Map();for(const [k,m] of votes){const [best]=[...m].sort((a,b)=>b[1]-a[1]);const [primary,detailed]=best[0].split('|');out.set(k,{primary,detailed});}
 return out;
}

// Merge a parsed statement into the stored import record (idempotent: re-imports never duplicate).
export function mergeImport(existing,parsed){
 const record=existing?structuredClone(existing):{key:parsed.account.key,institution:parsed.institution,account:parsed.account,statements:[],transactions:[]};
 const byId=new Map(record.transactions.map(t=>[t.id,t]));for(const t of parsed.transactions)byId.set(t.id,t);
 record.transactions=[...byId.values()].sort((a,b)=>b.date.localeCompare(a.date));
 const st=record.statements.filter(s=>s.end!==parsed.period.end);st.push({start:parsed.period.start,end:parsed.period.end,previous:parsed.previous,total:parsed.total,count:parsed.transactions.length,limit:parsed.account.limit});
 record.statements=st.sort((a,b)=>a.end.localeCompare(b.end));
 const latest=record.statements.at(-1),newest=parsed.period.end>=latest.end;
 record.account={...(newest?{...record.account,...parsed.account}:record.account),limit:latest.limit??record.account.limit,balance:latest.total,asOf:latest.end};
 return record;
}

// Plaid-shaped records so finance.mjs classification treats imports like connected accounts.
export function importToPlaid(record,learned=new Map()){
 const a=record.account,accountId=`import-${record.key}`;
 const account={account_id:accountId,name:a.name,official_name:a.name,mask:a.mask,type:a.type,subtype:a.subtype,balances:{current:a.balance,available:a.limit!=null?Math.round((a.limit-a.balance)*100)/100:null,limit:a.limit,iso_currency_code:'CAD'}};
 const transactions=record.transactions.map(t=>({transaction_id:t.id,account_id:accountId,date:t.date,authorized_date:t.date,name:t.name,merchant_name:null,amount:t.amount,iso_currency_code:'CAD',pending:false,personal_finance_category:categorize(t.name,learned)}));
 return {account,transactions};
}
