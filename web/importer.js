// Reads the files you pick for import: PDFs directly, and ZIP archives (including ZIPs inside ZIPs).
// Uses the browser's built-in decompression, so there is no extra library to load.
const u16=(v,o)=>v.getUint16(o,true),u32=(v,o)=>v.getUint32(o,true);
async function inflate(bytes){const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));return new Uint8Array(await new Response(stream).arrayBuffer());}
export async function unzip(bytes,depth=0){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];let eocd=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(v,i)===0x06054b50){eocd=i;break;}
 if(eocd<0)throw Error('This ZIP file could not be read.');
 let p=u32(v,eocd+16);const count=u16(v,eocd+10),dec=new TextDecoder();
 for(let n=0;n<count;n++){
  if(u32(v,p)!==0x02014b50)break;
  const method=u16(v,p+10),size=u32(v,p+20),nameLen=u16(v,p+28),extraLen=u16(v,p+30),commentLen=u16(v,p+32),local=u32(v,p+42),name=dec.decode(bytes.subarray(p+46,p+46+nameLen));
  p+=46+nameLen+extraLen+commentLen;
  const base=name.split('/').pop();
  if(name.endsWith('/')||name.includes('__MACOSX')||base.startsWith('._')||base.startsWith('.'))continue;
  if(!/\.(pdf|zip)$/i.test(base))continue;
  const start=local+30+u16(v,local+26)+u16(v,local+28),raw=bytes.subarray(start,start+size);
  const data=method===0?raw:method===8?await inflate(raw):null;if(!data)continue;
  if(/\.zip$/i.test(base)){if(depth<3)out.push(...await unzip(data,depth+1));}else out.push({name:base,bytes:data});
 }
 return out;
}
export async function collectStatements(fileList){
 const out=[];
 for(const f of fileList){const bytes=new Uint8Array(await f.arrayBuffer());if(/\.zip$/i.test(f.name))out.push(...await unzip(bytes));else if(/\.pdf$/i.test(f.name))out.push({name:f.name,bytes});}
 // Skip exact duplicates by content; the server also deduplicates transactions.
 const seen=new Set(),unique=[];
 for(const f of out){const h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',f.bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');if(!seen.has(h)){seen.add(h);unique.push(f);}}
 return unique.sort((a,b)=>a.name.localeCompare(b.name));
}
export function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(s);}
