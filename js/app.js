const $ = (id) => document.getElementById(id);

const form = $("login-form");
const emailInput = $("email");
const passwordInput = $("password");
const message = $("message");
const loginButton = $("login-button");
const signInButton = $("signin-button");
const togglePassword = $("toggle-password");

function showMessage(text, type = "") {
  if (!message) return;

  message.textContent = text;
  message.className = "message";

  if (type) {
    message.classList.add(type);
  }
}

// Show or hide password
if (togglePassword && passwordInput) {
  togglePassword.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";

    passwordInput.type = isPassword ? "text" : "password";
    togglePassword.textContent = isPassword ? "◎" : "◉";
    togglePassword.setAttribute(
      "aria-label",
      isPassword ? "Hide password" : "Show password"
    );
  });
}

// Sign in using Supabase
async function signIn() {
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showMessage("Please enter your email address and password.", "error");
    return;
  }

  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    showMessage(
      "Supabase is not configured. Please check js/config.js.",
      "error"
    );
    return;
  }

  if (!window.supabase) {
    showMessage(
      "Unable to load Supabase. Check your internet connection.",
      "error"
    );
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = "Signing in...";
  showMessage("");

  try {
    const client = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    );

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      showMessage(error.message, "error");
      return;
    }

    if (data.user) {
      showMessage("Login successful. Opening your dashboard...", "success");

      // Redirect only if your project has an existing dashboard page.
      // Change this filename if your actual dashboard uses another name.
      window.location.href = "dashboard.html";
    }
  } catch (error) {
    console.error("Login error:", error);
    showMessage("An unexpected error occurred. Please try again.", "error");
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Login";
  }
}

// Submit the login form
if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signIn();
  });
}

// The second button uses the same sign-in process
if (signInButton) {
  signInButton.addEventListener("click", async () => {
    if (form && !form.reportValidity()) return;
    await signIn();
  });
}