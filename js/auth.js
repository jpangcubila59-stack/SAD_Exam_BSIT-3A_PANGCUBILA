(() => {
  const form=document.getElementById('login-form'), emailInput=document.getElementById('email'), passwordInput=document.getElementById('password'), message=document.getElementById('message'), loginButton=document.getElementById('login-button'), signinButton=document.getElementById('signin-button'), togglePassword=document.getElementById('toggle-password');
  function showMessage(text,type='error'){message.textContent=text;message.className=`message ${type}`;}
  togglePassword.addEventListener('click',()=>{const show=passwordInput.type==='password';passwordInput.type=show?'text':'password';togglePassword.setAttribute('aria-label',show?'Hide password':'Show password');});
  async function signIn(event){if(event)event.preventDefault();const email=emailInput.value.trim(),password=passwordInput.value;
    if(!email||!password){showMessage('Please enter both your email address and password.');(!email?emailInput:passwordInput).focus();return;}
    if(!emailInput.checkValidity()){showMessage('Please enter a valid email address.');emailInput.focus();return;}
    const url=window.SUPABASE_URL,key=window.SUPABASE_ANON_KEY;
    if(!url||!key||url.startsWith('YOUR_')||key.startsWith('YOUR_')){showMessage('Supabase is not configured yet. Add your project URL and key in js/config.js.');return;}
    if(!window.supabase||typeof window.supabase.createClient!=='function'){showMessage('The authentication library could not load. Check your internet connection and reload.');return;}
    loginButton.disabled=true;signinButton.disabled=true;loginButton.textContent='Signing in...';showMessage('','success');
    try{const client=window.supabase.createClient(url,key);const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;if(!data.user)throw new Error('Sign-in did not return a user account.');
      const {data:profile,error:profileError}=await client.from('profiles').select('role').eq('id',data.user.id).single();
      if(profileError||!profile||!profile.role){await client.auth.signOut();throw new Error('No role profile was found for this account. Ask the scholarship office to configure it.');}
      const role=String(profile.role).toLowerCase();if(role==='scholar'||role==='student')location.href='scholar-dashboard.html';else if(role==='staff'||role==='admin')location.href='staff-dashboard.html';else{await client.auth.signOut();throw new Error('Your account role is not recognized. Contact the scholarship office.');}
    }catch(error){showMessage(error.message||'Unable to sign in. Check your details and try again.');}finally{loginButton.disabled=false;signinButton.disabled=false;loginButton.textContent='Login';}
  }
  form.addEventListener('submit',signIn);signinButton.addEventListener('click',signIn);
})();
