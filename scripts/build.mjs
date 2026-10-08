import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {configurationIssues} from '../lib/config.mjs';

// Packaging and syntax validation must not require database access or credentials.
for(const file of ['app.mjs','lib/runtime.mjs','web/app.js','web/login.js','api/index.mjs']){
 const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status || 1);
}
mkdirSync('static',{recursive:true});
const issues=configurationIssues();
if(issues.length){
 console.warn(`Build complete. Database setup skipped: ${issues.join(', ')}.`);
 console.warn('The app will return HTTP 503 and deny access until configured. Add the variables in Vercel Project Settings > Environment Variables, then redeploy. Set INITIAL_PASSWORD for the first owner setup only.');
}else{
 // Once configured, preserve the existing deployment-time migration/owner setup.
 const result=spawnSync(process.execPath,['scripts/setup.mjs'],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status || 1);
 console.log('Build and database setup complete.');
}
