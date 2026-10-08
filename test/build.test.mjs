import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {configurationIssues} from '../lib/config.mjs';

test('Vercel build without environment variables succeeds without database setup',()=>{
 const env={...process.env,VERCEL:'1',NODE_ENV:'production'};
 for(const key of ['APP_URL','OWNER_EMAIL','BETTER_AUTH_SECRET','DATABASE_URL','DATA_ENCRYPTION_KEY','INITIAL_PASSWORD'])delete env[key];
 const result=spawnSync(process.execPath,['scripts/build.mjs'],{env,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stderr,/Database setup skipped/);
 assert.match(result.stderr,/APP_URL/);
 assert.match(result.stderr,/HTTP 503/);
 assert.doesNotMatch(result.stdout,/Owner created/);
});
test('production configuration reports all missing requirements without exposing values',()=>{
 assert.equal(configurationIssues({VERCEL:'1'}).length,5);
 const configured={VERCEL:'1',APP_URL:'https://finance.example.com',OWNER_EMAIL:'owner@example.test',BETTER_AUTH_SECRET:'s'.repeat(40),DATABASE_URL:'postgres://private',DATA_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64')};
 assert.deepEqual(configurationIssues(configured),[]);
 assert.match(configurationIssues({...configured,APP_URL:'http://finance.example.com'}).join(','),/HTTPS/);
 assert.match(configurationIssues({...configured,DATA_ENCRYPTION_KEY:'secret-not-valid'}).join(','),/32 bytes/);
 assert.ok(!configurationIssues({...configured,DATA_ENCRYPTION_KEY:'secret-not-valid'}).join(',').includes('secret-not-valid'));
});
test('unconfigured hosted handler fails closed with setup response, including all data routes',()=>{
 const env={...process.env,VERCEL:'1',NODE_ENV:'production'};
 for(const key of ['APP_URL','OWNER_EMAIL','BETTER_AUTH_SECRET','DATABASE_URL','DATA_ENCRYPTION_KEY'])delete env[key];
 const script=`import handler from './app.mjs';
 for(const url of ['/','/login','/api/data?mode=live','/api/data?mode=demo','/api/status']){
 let status,body;const res={writeHead(s){status=s;},end(b){body=b;}};
 await handler({url,method:'GET',headers:{host:'example.com'}},res);
 if(status!==503)throw Error('Expected 503 for '+url);
 if(url.startsWith('/api/') && JSON.parse(body).error!=='SETUP_REQUIRED')throw Error('Expected setup error');
 }
 console.log('All unconfigured routes closed');`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/All unconfigured routes closed/);
});
