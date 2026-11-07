// Shared, side-effect-free validation. Never include secret values in diagnostics.
// Preview deployments use Vercel's stable per-branch address automatically, so every
// test branch works without setting APP_URL by hand. Production always uses APP_URL.
export function appOrigin(env=process.env){
 const hosted=!!env.VERCEL || env.NODE_ENV==='production';
 if(env.VERCEL_ENV==='preview'&&env.VERCEL_BRANCH_URL)return `https://${env.VERCEL_BRANCH_URL}`;
 return env.APP_URL || (hosted?'':`http://localhost:${env.PORT || 4317}`);
}
export function configurationIssues(env=process.env){
 const hosted=!!env.VERCEL || env.NODE_ENV==='production';
 const origin=appOrigin(env);
 const issues=[];
 if(!origin)issues.push('APP_URL');
 else {try {const url=new URL(origin);if(url.origin!==origin || !['http:','https:'].includes(url.protocol) || (hosted&&url.protocol!=='https:'))issues.push('APP_URL (exact HTTPS origin, without a trailing slash)');}catch{issues.push('APP_URL (valid URL required)');}}
 if(!env.OWNER_EMAIL?.trim())issues.push('OWNER_EMAIL');
 if(!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length<32)issues.push('BETTER_AUTH_SECRET (at least 32 characters)');
 if(hosted&&!env.DATABASE_URL)issues.push('DATABASE_URL');
 if(hosted&&!env.DATA_ENCRYPTION_KEY)issues.push('DATA_ENCRYPTION_KEY');
 else if(env.DATA_ENCRYPTION_KEY && Buffer.from(env.DATA_ENCRYPTION_KEY,'base64').length!==32)issues.push('DATA_ENCRYPTION_KEY (32 bytes encoded as base64)');
 return issues;
}
export class ConfigurationError extends Error {
 constructor(issues){super(`Configure these environment variables: ${issues.join(', ')}`);this.name='ConfigurationError';this.issues=issues;}
}
