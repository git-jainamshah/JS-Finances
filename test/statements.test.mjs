import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {parseRbcCreditCard,detectFormat,mergeImport,importToPlaid,categorize,learnCategories} from '../statements.mjs';
import {classifyTransactions,summarize} from '../finance.mjs';
import {unzip} from '../web/importer.js';

// Synthetic statement rows shaped like the PDF text layer (no real customer data).
const row=(...items)=>({page:1,y:0,items:items.map(([x,s])=>({x,s})),text:items.map(i=>i[1]).join('  ')});
const statement=({last4='0001',start='DEC 05, 2025',end='JAN 5, 2026',previous='$100.00',total,lines,limit='$5,000.00'})=>[
 row([60,'RBC Rewards+'],[141,'TM'],[155,'Visa'],[391,'in a few simple clicks. Get help']),
 row([60,'JANE DOE'],[118,`4510 14** **** ${last4}`]),
 row([60,`STATEMENT FROM ${start} TO ${end}`]),
 row([57,'PREVIOUS ACCOUNT BALANCE'],[310,previous],[391,'IMPORTANT INFORMATION']),
 row([391,'Credit limit'],[550,limit]),
 ...lines,
 row([391,'Total Account Balance'],[560,total])
];
const tx=(d,p,desc,amt,ref)=>[row([59,d],[95,p],[128,desc],[322,amt],[391,'Minimum payment'],[565,'$10.00']),...(ref?[row([128,ref])]:[])];

test('parses an RBC card statement across the new year and reconciles it',()=>{
 const rows=statement({total:'$62.89',lines:[...tx('DEC 28','DEC 29','TIM HORTONS #1 TORONTO ON','$5.64','74703416276408598131709'),...tx('JAN 02','JAN 03','NETFLIX.COM','$23.99','24011346258100129853389'),row([128,'Foreign Currency - USD 12.95 Exchange rate - 1.427799']),...tx('JAN 03','JAN 03','PAYMENT - THANK YOU / PAIEMENT - MERCI','-$70.00'),...tx('JAN 05','JAN 05','PURCHASE INTEREST 20.99%','$3.26')]});
 assert.equal(detectFormat(rows),'rbc-credit-card');
 const p=parseRbcCreditCard(rows);
 assert.equal(p.reconciled,true);assert.deepEqual(p.period,{start:'2025-12-05',end:'2026-01-05'});
 assert.deepEqual(p.transactions.map(t=>t.date),['2025-12-28','2026-01-02','2026-01-03','2026-01-05']);
 assert.equal(p.transactions[1].note,'USD 12.95 @ 1.427799');assert.equal(p.transactions[0].id,'rbc-0001-74703416276408598131709');
 assert.equal(p.account.name,'RBC Rewards+ Visa');assert.equal(p.account.limit,5000);
});
test('rejects statements whose transactions do not add up',()=>{
 const p=parseRbcCreditCard(statement({total:'$999.00',lines:tx('JAN 02','JAN 03','NETFLIX.COM','$23.99','1'.repeat(23))}));
 assert.equal(p.reconciled,false);assert.equal(p.difference,-875.01);
});
test('re-imports never duplicate and a reissued card stays one account',()=>{
 const older=parseRbcCreditCard(statement({last4:'1167',start:'NOV 05',end:'DEC 4, 2025',previous:'$0.00',total:'$10.00',lines:tx('NOV 10','NOV 11','SPOTIFY','$10.00','2'.repeat(23))}));
 const newer=parseRbcCreditCard(statement({last4:'4039',previous:'$10.00',total:'$33.99',lines:tx('JAN 02','JAN 03','NETFLIX.COM','$23.99','3'.repeat(23)),limit:'$18,000.00'}));
 assert.equal(older.account.key,newer.account.key);
 let r=mergeImport(null,newer);r=mergeImport(r,older);r=mergeImport(r,newer);
 assert.equal(r.transactions.length,2);assert.equal(r.statements.length,2);assert.equal(r.account.mask,'4039');assert.equal(r.account.balance,33.99);assert.equal(r.account.limit,18000);
});
test('imported card data flows through normal classification',()=>{
 const p=parseRbcCreditCard(statement({total:'$45.64',lines:[...tx('JAN 02','JAN 03','TIM HORTONS #1 TORONTO ON','$5.64','4'.repeat(23)),...tx('JAN 03','JAN 03','SOME NEW SHOP TORONTO ON','$40.00','5'.repeat(23)),...tx('JAN 04','JAN 04','PAYMENT - THANK YOU / PAIEMENT - MERCI','-$100.00'),...tx('JAN 04','JAN 04','IQBAL FOODS TORONTO ON','$100.00','6'.repeat(23))]}));
 const learned=learnCategories([{name:'Some New Shop',personal_finance_category:{primary:'GENERAL_MERCHANDISE',detailed:'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',confidence_level:'HIGH'}}]);
 const {account,transactions}=importToPlaid(mergeImport(null,p),learned),rows=classifyTransactions(transactions,[account],'RBC');
 const by=n=>rows.find(t=>t.name.startsWith(n));
 assert.equal(by('PAYMENT').kind,'credit_payment');assert.equal(by('TIM').category,'Food & dining');assert.equal(by('SOME NEW').category,'Shopping');assert.equal(by('IQBAL').category,'Groceries');
 assert.equal(summarize(rows).spending,145.64);
 assert.equal(categorize('MYSTERY MERCHANT XYZ').primary,'UNCATEGORIZED');
});
test('ZIP reader finds PDFs in nested archives and skips macOS metadata',async()=>{
 const zip=entries=>{const parts=[],central=[];let off=0;const enc=new TextEncoder();
  for(const [name,data,deflate] of entries){const n=enc.encode(name),body=deflate?deflateRawSync(data):data,lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(deflate?8:0,8);lh.writeUInt32LE(body.length,18);lh.writeUInt32LE(data.length,22);lh.writeUInt16LE(n.length,26);
   const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(deflate?8:0,10);ch.writeUInt32LE(body.length,20);ch.writeUInt32LE(data.length,24);ch.writeUInt16LE(n.length,28);ch.writeUInt32LE(off,42);
   parts.push(lh,n,body);central.push(ch,n);off+=30+n.length+body.length;}
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);
  return new Uint8Array(Buffer.concat([...parts,cd,end]));};
 const pdf=Buffer.from('%PDF-1.7 test '.repeat(20));
 const inner=zip([['2025/a.pdf',pdf,true],['2025/.DS_Store',Buffer.from('x'),false]]);
 const outer=zip([['all/inner.zip',Buffer.from(inner),true],['__MACOSX/all/._b.pdf',Buffer.from('x'),false],['all/b.pdf',pdf,false]]);
 const files=await unzip(outer);
 assert.deepEqual(files.map(f=>f.name).sort(),['a.pdf','b.pdf']);assert.equal(Buffer.from(files[0].bytes).toString(),pdf.toString());
});
