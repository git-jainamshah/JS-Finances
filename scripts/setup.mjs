import {getMigrations} from 'better-auth/db/migration';
import {betterAuth} from 'better-auth';
import {getRuntime} from '../lib/runtime.mjs';
const runtime=getRuntime();
try {
 const {runMigrations}=await getMigrations(runtime.options);await runMigrations();
 await runtime.query(`CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, env TEXT NOT NULL, token TEXT NOT NULL, cursor TEXT, institution TEXT, synced TEXT, accounts TEXT DEFAULT '[]', transactions TEXT DEFAULT '[]')`);
 await runtime.query(`CREATE TABLE IF NOT EXISTS plaid_config (env TEXT PRIMARY KEY, client_id TEXT NOT NULL, secret TEXT NOT NULL, updated_at TEXT NOT NULL, verified_at TEXT)`);
 try{await runtime.query('SELECT verified_at FROM plaid_config LIMIT 1');}catch{await runtime.query('ALTER TABLE plaid_config ADD COLUMN verified_at TEXT');}
 const users=await runtime.query('SELECT id,email FROM "user"');
 if(users.length){
  if(users.length!==1 || users[0].email.toLowerCase()!==runtime.owner)throw Error('Database owner does not match OWNER_EMAIL. Refusing to seed another user.');
  console.log('Schema ready. Existing owner and password preserved.');
 }else{
  const password=process.env.INITIAL_PASSWORD;
  if(!password || password.length<12)throw Error('Set INITIAL_PASSWORD (at least 12 characters) for the first setup only');
  // This signup-enabled instance is accessible only in this offline setup script.
  const seed=betterAuth({...runtime.options,emailAndPassword:{...runtime.options.emailAndPassword,disableSignUp:false}});
  await seed.api.signUpEmail({body:{email:runtime.owner,password,name:'Jainam Shah'}});
  console.log('Owner created. Remove INITIAL_PASSWORD from the environment after setup.');
 }
}finally{await runtime.close();}
