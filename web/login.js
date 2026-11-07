const $=id=>document.getElementById(id),form=$('login-form'),email=$('email'),pw=$('password'),button=$('submit'),message=$('login-message');
const emailOk=()=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
const showError=text=>{message.querySelector('span').textContent=text;message.hidden=!text;};
let touched=false;
const validate=()=>{if(!touched)return;email.setAttribute('aria-invalid',String(!emailOk()));$('email-err').hidden=emailOk();pw.setAttribute('aria-invalid',String(pw.value.length<12));};
email.addEventListener('input',()=>{showError('');validate();});pw.addEventListener('input',()=>{showError('');validate();});
pw.addEventListener('keyup',e=>{$('caps').hidden=!(e.getModifierState&&e.getModifierState('CapsLock'));});
$('toggle-pw').addEventListener('click',e=>{const show=pw.type==='password';pw.type=show?'text':'password';e.currentTarget.textContent=show?'Hide':'Show';e.currentTarget.setAttribute('aria-pressed',String(show));e.currentTarget.setAttribute('aria-label',show?'Hide password':'Show password');});
const busy=on=>{button.disabled=on;button.querySelector('.spin').hidden=!on;button.querySelector('.label').textContent=on?'Signing in…':'Sign in';};
form.addEventListener('submit',async e=>{
 e.preventDefault();if(button.disabled)return;touched=true;validate();
 if(!emailOk()||pw.value.length<12){showError(!emailOk()?'Check your email address and try again.':'Your password has at least 12 characters.');return;}
 busy(true);showError('');
 try{
  const res=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.value.trim(),password:pw.value,rememberMe:false})});
  if(!res.ok)throw Error(res.status===429?'Too many attempts. Please wait a minute and try again.':'That email and password don’t match. After 5 attempts, sign-in pauses for a minute.');
  pw.value='';location.replace('/');
 }catch(err){showError(err.message);busy(false);}
});
