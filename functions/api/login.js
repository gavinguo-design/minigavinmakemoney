// Cloudflare Pages Function: POST /api/login
// Body: { username, password } → sets signed HttpOnly cookie (mg_auth, 30d).
// Password is never stored in plaintext here — SHA-256 hash comparison only.

const SECRET = 'mg-auth-06745e6f2f34d7a8d1e8f772e31cb09be7175a27bd84bf19b675598aa13a855e';
const COOKIE_NAME = 'mg_auth';
const VALID_USERNAME = 'gavin';
// sha256 hex of the account password
const PASSWORD_SHA256 = '4594668a213d63f0e3c5931b3163a03ca7fb38632a38385a1841c57302d49f61';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export async function onRequestPost(context) {
  const { request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }

  const username = String(body.username || '');
  const password = String(body.password || '');

  const passHash = await sha256Hex(password);
  if (username !== VALID_USERNAME || passHash !== PASSWORD_SHA256) {
    return json({ ok: false, error: 'invalid credentials' }, 401);
  }

  const exp = String(Date.now() + TOKEN_TTL_MS);
  const sig = await hmacHex(exp);
  const token = `${exp}.${sig}`;
  const maxAge = Math.floor(TOKEN_TTL_MS / 1000);
  const cookie = `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ ok: false, error: 'method not allowed' }, 405);
}
