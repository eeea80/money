/**
 * Avalisa sign-in, hosted on the EXTENSION origin and embedded in the on-page
 * panel as an iframe.
 *
 * Why an iframe rather than fields in the panel itself: the panel is injected
 * into Pocket Option's own DOM, so anything typed there is readable by PO's page
 * scripts and by every other installed extension, and Chrome's password manager
 * refills it against po.trade on every load. This document is same-origin with
 * the extension and cross-origin to the page, so the page cannot reach into it —
 * while still appearing right in the panel, with no extra clicks.
 */
const API_BASE = 'https://avalisa-backend.onrender.com';

const $ = id => document.getElementById(id);
const setMsg = (text, kind) => {
  const el = $('msg');
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
};

async function signIn() {
  const email = $('email').value.trim();
  const passwordEl = $('password');
  const password = passwordEl.value;
  if (!email || !password) {
    setMsg('Enter your email and password.', 'error');
    return;
  }

  $('submit').disabled = true;
  setMsg('Connecting...');
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error || 'Login failed.', 'error');
      return;
    }
    passwordEl.value = '';
    await chrome.storage.local.set({
      jwt: data.token,
      userId: data.user.id,
      userEmail: email,
    });
    setMsg('Signed in.', 'ok');
    // The panel also watches chrome.storage, but tell it directly so the UI
    // swaps over instantly rather than on the next storage event.
    try { parent.postMessage({ type: 'AVALISA_AUTH_OK' }, '*'); } catch (_) {}
  } catch (err) {
    setMsg('Login error — check your connection.', 'error');
  } finally {
    $('submit').disabled = false;
  }
}

$('submit').addEventListener('click', signIn);
$('password').addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });
$('email').addEventListener('keydown', e => { if (e.key === 'Enter') $('password').focus(); });
