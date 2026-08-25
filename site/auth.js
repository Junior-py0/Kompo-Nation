(() => {
const { getSession, signIn, signUp } = window.KOMPO_SUPABASE;
// SIGNUP_TERMS_ACCEPTANCE_V1
const CURRENT_TERMS_VERSION = "1.0";

const form = document.querySelector("#auth-form");
const message = document.querySelector("#auth-message");
const submit = document.querySelector("#auth-submit");
const signupFields = document.querySelector("#signup-fields");
const signinTab = document.querySelector("#signin-tab");
const signupTab = document.querySelector("#signup-tab");
let mode = "signin";

function safeNext() {
  const value = new URLSearchParams(location.search).get("next") || "/account";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

function continueToRequestedArea() {
  const next = safeNext();
  if (location.protocol !== "file:") {
    location.href = next;
    return;
  }
  if (next === "/admin") location.href = "./admin.html";
  else if (next === "/vendor") location.href = "./vendor.html";
  else location.href = `./index.html#${next}`;
}

function setMode(nextMode) {
  mode = nextMode;
  const signingUp = mode === "signup";
  signupFields.hidden = !signingUp;
  signinTab.classList.toggle("active", !signingUp);
  signupTab.classList.toggle("active", signingUp);
  submit.textContent = signingUp ? "Create account" : "Sign in";
  form.elements.password.autocomplete = signingUp ? "new-password" : "current-password";
  form.elements.fullName.required = signingUp;
  form.elements.phone.required = signingUp;
  form.elements.acceptTerms.required = signingUp;
  message.textContent = "";
}

signinTab.addEventListener("click", () => setMode("signin"));
signupTab.addEventListener("click", () => setMode("signup"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  submit.textContent = mode === "signup" ? "Creating account…" : "Signing in…";
  message.textContent = "";
  const values = Object.fromEntries(new FormData(form));
  try {
    if (mode === "signup") {
      if (values.acceptTerms !== "on") {
        throw new Error(
          "You must accept the Terms of Service before creating an account."
        );
      }

      const termsAcceptedAt =
        new Date().toISOString();

      const result = await signUp({
        email:
          values.email
            .trim()
            .toLowerCase(),

        password:
          values.password,

        fullName:
          values.fullName.trim(),

        phone:
          values.phone.trim(),

        termsVersion:
          CURRENT_TERMS_VERSION,

        termsAcceptedAt
      });
      if (!result.session) {
        message.textContent = "Check your email to confirm the account, then return here to sign in.";
        setMode("signin");
        form.elements.email.value = values.email;
        return;
      }
    } else await signIn(values.email.trim().toLowerCase(), values.password);
    continueToRequestedArea();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = mode === "signup" ? "Create account" : "Sign in";
  }
});

getSession().then((session) => {
  if (session) {
    message.innerHTML = `You are signed in as <strong>${session.user.email}</strong>. Continue to your requested area or sign out from your account.`;
    submit.textContent = "Continue";
    form.addEventListener("submit", (event) => { event.preventDefault(); continueToRequestedArea(); }, { once: true, capture: true });
  }
}).catch(() => {});
})();
