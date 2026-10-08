import assert from 'node:assert/strict';
const base=process.env.APP_URL || 'http://localhost:4317';
for(const path of ['/api/status','/api/data?mode=live','/api/data?mode=demo'])assert.equal((await fetch(base+path)).status,401);
for(const path of ['/','/app.js','/finance.mjs','/.env','/.data/key'])assert.equal((await fetch(base+path,{redirect:'manual'})).status,302);
assert.equal((await fetch(base+'/login')).status,200);
console.log('PASS: running dashboard and financial APIs require authentication');
