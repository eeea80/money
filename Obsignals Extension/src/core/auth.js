import { get as readPref, remove as removePref, set as writePref } from "./prefs.js";
import { getLocale } from "../i18n/index.js";

/**
 * Accounts.
 *
 * Two servers, on purpose:
 *
 *   Firebase Auth   passwords, tokens, reset and verification mail. Talked to
 *                   directly, because putting a server of ours in the middle of
 *                   a password check only creates another place the password
 *                   has been.
 *
 *   Obsignals API   what the account has paid for. It is the only thing that
 *                   can read the plan, and the only thing that can change it.
 *
 * The web API key below is public by design — it identifies the project, it
 * does not authorise anything. What guards the data is Firebase's own rules and
 * the token checks on our API.
 *
 * The password exists in the input and in one request. What stays on the
 * machine is the pair of tokens Firebase hands back.
 */

const FIREBASE_KEY = "AIzaSyBesnXKUFc2dGX2HAo-hHVoeaXect1TBUE";

/**
 * Public in the same way, and for the same reason: it names the app on Google's
 * sign-in page. The client this belongs to has a secret, which is not here and
 * is not needed — nothing in an extension can keep one.
 */
const GOOGLE_CLIENT_ID =
  "410069718261-lr3v7n4utvckth7jrl4agak2anlf8l9n.apps.googleusercontent.com";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const IDENTITY = "https://identitytoolkit.googleapis.com/v1/accounts";
const REFRESH = "https://securetoken.googleapis.com/v1/token";
const API = "https://auth.obsignals.com";

const SESSION_KEY = "obsignals.session";

/**
 * @typedef {object} Session
 * @property {string} idToken       short lived, an hour
 * @property {string} refreshToken  long lived, buys new id tokens
 * @property {number} expiresAt     epoch ms
 * @property {string} uid
 * @property {string} email
 * @property {string|null} plan
 * @property {{cataloguer: number, checklist: number}} [uso]  gasto da cota gratuita
 * @property {number} [limiteGratuito]  quantas de cada uma conta gratuita tem
 */

/** Carries a locale key, not a message: the screen decides the wording. */
export class AuthError extends Error {
  constructor(key) {
    super(key);
    this.key = key;
  }
}

// --- session ----------------------------------------------------------------

/** @returns {Session|null} */
export function getSession() {
  const raw = readPref(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // A session we cannot read is a session we do not have.
    removePref(SESSION_KEY);
    return null;
  }
}

function store(session) {
  writePref(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function signOut() {
  removePref(SESSION_KEY);
}

// --- firebase ---------------------------------------------------------------

async function identity(method, body) {
  let response;

  try {
    response = await fetch(`${IDENTITY}:${method}?key=${FIREBASE_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("auth.errorOffline");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AuthError(errorKey(payload.error?.message));
  return payload;
}

/**
 * Firebase names its failures in a header-style string. Mapping them here keeps
 * those names out of the screens, and out of what a user is shown.
 */
function errorKey(reason = "") {
  if (reason.startsWith("EMAIL_EXISTS")) return "auth.errorEmailTaken";
  if (reason.startsWith("WEAK_PASSWORD")) return "auth.errorWeakPassword";
  if (reason.startsWith("INVALID_EMAIL")) return "auth.errorInvalidEmail";
  if (reason.startsWith("TOO_MANY_ATTEMPTS")) return "auth.errorTooMany";

  /* Wrong password, unknown account and a disabled one all answer the same on
     purpose: a form that distinguishes them is a form that tells a stranger
     which addresses have accounts here. */
  if (
    reason.startsWith("INVALID_LOGIN_CREDENTIALS") ||
    reason.startsWith("INVALID_PASSWORD") ||
    reason.startsWith("EMAIL_NOT_FOUND") ||
    reason.startsWith("USER_DISABLED")
  ) {
    return "auth.errorBadCredentials";
  }

  if (reason.startsWith("TOKEN_EXPIRED") || reason.startsWith("USER_NOT_FOUND")) {
    return "auth.errorExpired";
  }

  return "auth.errorGeneric";
}

function sessionFrom(payload, previous = {}) {
  return store({
    ...previous,
    idToken: payload.idToken ?? payload.id_token,
    refreshToken: payload.refreshToken ?? payload.refresh_token,
    // A minute early, so a call never starts with a token that dies mid flight.
    expiresAt: Date.now() + (Number(payload.expiresIn ?? payload.expires_in) - 60) * 1000,
    uid: payload.localId ?? payload.user_id ?? previous.uid,
    email: payload.email ?? previous.email,
    plan: previous.plan ?? null,
  });
}

export async function signIn(email, password) {
  const payload = await identity("signInWithPassword", {
    email,
    password,
    returnSecureToken: true,
  });

  return loadPlan(sessionFrom(payload));
}

export async function signUp(email, password) {
  const payload = await identity("signUp", { email, password, returnSecureToken: true });

  /* No code is sent here. The account exists but the address is unconfirmed, so
     the gate lands on the confirmation screen — and that screen asks for the
     code itself, which is also what happens if the panel is closed halfway. One
     path instead of two. */
  return loadPlan(sessionFrom(payload));
}

/**
 * Whether the address on this session has been confirmed.
 *
 * Read out of the id token rather than stored beside it. The token is reissued
 * from the refresh token every hour and carries whatever the server last
 * decided, so this cannot drift — and a session saved by an older version of
 * the panel answers correctly too, having never stored a flag at all.
 *
 * The signature is not checked here, deliberately. This decides what to show;
 * the server verifies every token it is handed, and is the only thing that
 * decides what may be done.
 */
export function isVerified(session = getSession()) {
  if (!session?.idToken) return false;

  try {
    const [, body] = session.idToken.split(".");
    return Boolean(JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))).email_verified);
  } catch {
    // A token we cannot read is not a confirmation.
    return false;
  }
}

/**
 * Asks for the code to be mailed.
 *
 * @param {{resend?: boolean}} [options] `resend` is the user pressing the
 *   button; without it the server keeps any code already in flight, so opening
 *   the screen twice does not invalidate what someone is mid-way through typing.
 * @returns {Promise<{sent: boolean, retryIn: number, verified?: boolean}>}
 */
export function sendCode({ resend = false } = {}) {
  return api("/code", { method: "POST", body: { resend, locale: getLocale() } });
}

/**
 * Hands the code in, and refreshes the session on success.
 *
 * The refresh is not optional: the id token in hand still says unconfirmed, and
 * the gate reads the token. Without a new one the panel would keep asking for a
 * code that has already been accepted.
 */
export async function confirmCode(code) {
  try {
    await api("/confirm", { method: "POST", body: { code } });
  } catch (error) {
    // Three different problems with three different things to do about them.
    const key = {
      expired: "verify.errorExpired",
      wrong: "verify.errorWrong",
      burned: "verify.errorBurned",
    }[error.detail?.error];

    throw key ? new AuthError(key) : error;
  }

  const session = getSession();
  if (session) await renew(session);

  return refresh();
}

/**
 * Opens the Google window and asks whether that address can be signed in with.
 *
 * The check is the whole reason this is two steps. Signing in with Google on an
 * account that has a password makes Firebase drop the password — it reads the
 * verified provider as the stronger claim and retires the older one, without
 * telling anyone. The customer finds out later, typing a password that stopped
 * working.
 *
 * So: `linkFirst` means stop and ask for the password, then `linkGoogle`. Both
 * ways in keep working, which is the behaviour people expect from this button.
 *
 * @returns {Promise<{token: string, email: string, linkFirst: boolean}>}
 */
export async function beginGoogle() {
  const token = await googleToken();

  let response;
  try {
    /* The only call here with no session — there is not one yet. It is not open
       either: the server answers about an address only to a Google token issued
       for that address. */
    response = await fetch(`${API}/google`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    throw new AuthError("auth.errorOffline");
  }

  /* Failing shut. Carrying on without the answer risks destroying a paying
     customer's password; refusing costs a sign-in that can be retried. */
  if (!response.ok) throw new AuthError("auth.errorGeneric");

  const { linkFirst, email } = await response.json();
  return { token, email, linkFirst };
}

/** Signs in as the Google account. Safe once `linkFirst` came back false. */
export async function signInWithGoogle(token) {
  const payload = await withGoogle(token);

  /* Firebase keeps one account per address, and declines to merge on an
     unverified one. Nothing here can fix that, so it says so. */
  if (payload.needConfirmation) throw new AuthError("auth.errorGooglePassword");

  return loadPlan(sessionFrom(payload));
}

/**
 * Attaches Google to the account already signed in.
 *
 * The same endpoint, one field different — and that field is what makes it
 * additive. Signing in with a credential lets it claim an account; linking one
 * onto a live session only adds a way in, and leaves the password alone.
 */
export async function linkGoogle(token) {
  const session = getSession();
  if (!session) throw new AuthError("auth.errorExpired");

  return sessionFrom(await withGoogle(token, session.idToken), session);
}

function withGoogle(token, idToken) {
  return identity("signInWithIdp", {
    postBody: `id_token=${token}&providerId=google.com`,
    requestUri: chrome.identity.getRedirectURL(),
    returnSecureToken: true,
    ...(idToken && { idToken }),
  });
}

/** Closing the Google window is a decision, so it ends the flow saying nothing. */
export class Cancelled extends Error {}

async function googleToken() {
  const url = `${GOOGLE_AUTH}?${new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: "id_token",
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: "openid email profile",
    // Google binds the token to this. A fresh one each attempt is what stops a
    // token captured from one sign-in being replayed into another.
    nonce: crypto.randomUUID(),
    // Always ask which account, rather than assuming the one already open.
    prompt: "select_account",
  })}`;

  let redirected;
  try {
    redirected = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (error) {
    // Chrome reports a window the user closed and a misconfigured client the
    // same way, in prose. Only the first is a decision; the rest is worth saying.
    const reason = error?.message ?? "";
    throw /approve|cancel/i.test(reason) ? new Cancelled() : new AuthError("auth.errorGeneric");
  }

  /* The token comes back in the fragment, which never leaves the browser — it
     is not sent to the redirect host, and there is no host here anyway. */
  const token = new URLSearchParams(new URL(redirected).hash.slice(1)).get("id_token");
  if (!token) throw new AuthError("auth.errorGeneric");

  return token;
}

/**
 * Mails a code to someone who cannot sign in.
 *
 * Ours rather than Firebase's, and a code rather than a link: Firebase sends
 * from a hostname shared with every project there is, which lands in spam — and
 * this is the one mail that reaches a customer who is already locked out.
 *
 * Answers the same whether or not the address has an account. The screen says
 * "if that address has an account" for the same reason.
 */
export async function resetPassword(email) {
  await open("/reset", { email, locale: getLocale() });
}

/**
 * Sets the new password, and signs in with it.
 *
 * Signing in here rather than sending them back to the form: the panel has the
 * address and the password the user chose seconds ago, and asking for both
 * again would be asking them to prove something they just did.
 */
export async function completeReset(email, code, password) {
  try {
    await open("/reset/confirm", { email, code, password });
  } catch (error) {
    const key = {
      expired: "verify.errorExpired",
      wrong: "verify.errorWrong",
      burned: "verify.errorBurned",
      weak: "auth.errorShortPassword",
    }[error.detail?.error];

    throw key ? new AuthError(key) : error;
  }

  return signIn(email, password);
}

/**
 * A call with no session behind it.
 *
 * Only the two reset routes use this, and only because they cannot have one —
 * being unable to sign in is the reason for them. What stands in for the token
 * is the code, and the ceiling on the server. Everything else goes through
 * `api`, which will not move without one.
 */
async function open(path, body) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("auth.errorOffline");
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const failure = new AuthError("auth.errorGeneric");
    failure.detail = payload;
    throw failure;
  }

  return payload;
}

/**
 * Changes the password, after proving the current one.
 *
 * Firebase would accept the change on the token alone, and refusing to do that
 * is the point: a token lives on the machine, so without this step anyone who
 * sat down at an unlocked browser could lock the owner out of their own
 * account. Re-signing in is also what satisfies Firebase's own recency rule,
 * which otherwise rejects the update after an hour with an error the user
 * cannot act on.
 */
export async function changePassword(current, next) {
  const session = getSession();
  if (!session) throw new AuthError("auth.errorExpired");

  const proof = await identity("signInWithPassword", {
    email: session.email,
    password: current,
    returnSecureToken: true,
  });

  const payload = await identity("update", {
    idToken: proof.idToken,
    password: next,
    returnSecureToken: true,
  });

  // The old refresh token dies with the password, so the session has to be
  // replaced rather than kept — otherwise the next hour signs the user out.
  sessionFrom(payload, session);
}

/**
 * An id token lasts an hour; the refresh token is what outlives it.
 *
 * Everything that talks to our API comes through here, so a signed-in user
 * never sees a session end while they are looking at it.
 */
async function freshToken() {
  const session = getSession();
  if (!session) throw new AuthError("auth.errorExpired");
  if (Date.now() < session.expiresAt) return session.idToken;

  return (await renew(session)).idToken;
}

/**
 * Trades the refresh token for a new id token, whether or not the old one has
 * expired.
 *
 * Forcing it is what picks up a claim the server has just changed — confirming
 * an address is exactly that, and the panel reads the token to decide.
 */
async function renew(session) {
  let response;
  try {
    response = await fetch(`${REFRESH}?key=${FIREBASE_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
      }),
    });
  } catch {
    throw new AuthError("auth.errorOffline");
  }

  if (!response.ok) {
    // The refresh token is gone or revoked — this session is over.
    signOut();
    throw new AuthError("auth.errorExpired");
  }

  return sessionFrom(await response.json(), session);
}

// --- obsignals api ----------------------------------------------------------

async function api(path, { method = "GET", body } = {}) {
  const token = await freshToken();

  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body && { "content-type": "application/json" }),
      },
      ...(body && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new AuthError("auth.errorOffline");
  }

  const payload = await response.json().catch(() => ({}));

  if (response.status === 401) {
    signOut();
    throw new AuthError("auth.errorExpired");
  }

  if (!response.ok) {
    /* Most callers only need "it failed". The ones that asked a question with
       more than one wrong answer — a code that is stale versus mistyped —
       read this to tell them apart. */
    const failure = new AuthError("auth.errorGeneric");
    failure.detail = payload;
    throw failure;
  }

  return payload;
}

/** The plan, which only the server can answer. */
async function loadPlan(session) {
  try {
    const account = await api("/me");
    return store({
      ...session,
      email: account.email ?? session.email,
      plan: account.plan,
      /* Guardado para o contador aparecer no primeiro desenho, sem uma segunda
         ida ao servidor. Quem autoriza continua sendo a proxima resposta. */
      uso: account.uso,
      limiteGratuito: account.limiteGratuito,
    });
  } catch {
    // Signing in worked; the plan is a detail that can arrive late. Blocking on
    // it would lock someone out of the panel because the API blinked.
    return session;
  }
}

/**
 * Re-reads the account from the server.
 *
 * The plan changes while the panel is closed — which is exactly what
 * subscribing does — so a stored session says who, never what.
 */
export async function refresh() {
  const session = getSession();
  if (!session) return null;

  try {
    return await loadPlan(session);
  } catch (error) {
    if (error.key === "auth.errorExpired") return null;
    return session;
  }
}

/**
 * Pede ao servidor algo que custa uma das cotas gratuitas.
 *
 * O painel nao fala com o motor de catalogacao: fala com este servidor, que
 * confere o token, cobra a cota e so entao pergunta la. Assim a cota nao vive
 * no navegador — apagar os dados da extensao nao devolve nenhuma lista — e o
 * cobrar e o entregar viram um pedido so, o que faz desaparecer o "gastei e a
 * consulta falhou".
 *
 * @param {string} caminho  "/cataloger" ou "/check"
 * @param {object} corpo    o pedido, conferido do outro lado
 * @returns {Promise<Array>} as linhas, ja sem o que a tela nao mostra
 * @throws {AuthError} `cota.esgotada` quando nao ha mais nenhuma
 */
export async function pedirComCota(caminho, corpo) {
  let resposta;
  try {
    resposta = await api(caminho, { method: "POST", body: corpo });
  } catch (erro) {
    /* "Acabou" e uma resposta, nao uma falha: a tela tranca em vez de mostrar
       erro de rede. Qualquer outra coisa continua sendo falha. */
    if (erro.detail?.error === "quota exhausted") {
      anotarCota(caminho, { restantes: 0, limite: erro.detail.limite });
      throw new AuthError("cota.esgotada");
    }
    throw erro;
  }

  anotarCota(caminho, resposta);
  return resposta.linhas ?? [];
}

/** O caminho e o nome da ferramenta sao a mesma palavra, menos a barra. */
const FERRAMENTA = { "/cataloger": "cataloguer", "/check": "checklist" };

/**
 * Guarda o que sobrou, para o contador na tela nao precisar de outra ida ao
 * servidor. E so para mostrar: quem autoriza continua sendo a proxima resposta.
 */
function anotarCota(caminho, { restantes, limite }) {
  const session = getSession();
  const ferramenta = FERRAMENTA[caminho];
  if (!session || !ferramenta || restantes == null) return;

  const teto = Number(limite) || session.limiteGratuito;
  store({
    ...session,
    uso: { ...session.uso, [ferramenta]: Math.max(0, teto - restantes) },
    ...(teto && { limiteGratuito: teto }),
  });
}

/** Opens Stripe's checkout for a plan, already tied to this account. */
export async function startCheckout(priceId) {
  const { url } = await api("/checkout", { method: "POST", body: { priceId } });
  return url;
}

/**
 * Erases the account, everywhere.
 *
 * Two steps in this order and no other: the server needs a valid token to end
 * the subscription and remove the record, and the Firebase user is what mints
 * that token. Deleting the user first would strand the subscription billing a
 * person who no longer has an account.
 */
export async function deleteAccount() {
  await api("/delete", { method: "POST" });
  signOut();
}

/**
 * Sends a support message.
 *
 * No address is passed: the server takes it from the account behind the token,
 * so a reply always reaches the person who wrote rather than whatever was
 * typed into a field.
 */
export async function sendSupportMessage({ subject, message }) {
  await api("/contact", { method: "POST", body: { subject, message } });
}

/** Opens the customer's own subscription, where they can cancel it. */
export async function openBilling() {
  const { url } = await api("/portal", { method: "POST" });
  return url;
}
