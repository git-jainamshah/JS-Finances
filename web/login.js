const form=document.getElementById('login-form'),message=document.getElementById('login-message'),button=document.getElementById('submit');
form.addEventListener('submit',async e=>{
 e.preventDefault();button.disabled=true;button.textContent='Signing in…';message.hidden=true;
 try{
  const res=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.email.value.trim(),password:form.password.value,rememberMe:false})});
  if(!res.ok)throw Error(res.status===429?'Too many attempts. Please wait a minute and try again.':'Unable to sign in. Check your email and password.');
  form.password.value='';location.replace('/');
 }catch(e){message.textContent=e.message;message.hidden=false;}finally{button.disabled=false;button.textContent='Sign in →';}
});
