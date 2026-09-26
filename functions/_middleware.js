// Cloudflare Pages Function: global middleware — site-wide login gate.
//
// Every request must carry a valid signed cookie (mg_auth), except:
//   - the login page + login API themselves
//   - read-only market/analysis data endpoints relied on by pre-market cron
//     (curl https://minigavin.com/api/kline..., annotations.json verify curl):
//       /api/kline            Yahoo K-line proxy
//       /api/realtime         realtime HSI quote (multi-upstream)
//       /chart/annotations.json
//       /chart/archive/*      frozen daily snapshots (read-only history)
//       /chart/predictions/*  prediction log (public track record data)
//
// NOT whitelisted (personal data — must stay behind auth):
//       /chart/trades.json    personal positions / trade log
//       all HTML pages
//
// Token format: "<expiryMs>.<hmacSha256Hex(expiryMs)>", 30-day expiry.

const SECRET = 'mg-auth-06745e6f2f34d7a8d1e8f772e31cb09be7175a27bd84bf19b675598aa13a855e';
const COOKIE_NAME = 'mg_auth';

const WHITELIST_EXACT = new Set([
  '/login',        // Pages pretty-URL (308 from /login.html)
  '/login.html',
  '/api/login',
  '/favicon.ico',
  '/favicon-32.png',
  '/favicon-16.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/robots.txt',
  '/chart/annotations.json',
]);

const WHITELIST_PREFIX = [
  '/api/kline',
  '/api/realtime',
  '/chart/archive/',
  '/chart/predictions/',
];

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

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

async function verifyToken(token) {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmacHex(expStr);
  if (sig.length !== expected.length) return false;
  // constant-time-ish compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (WHITELIST_EXACT.has(path) || WHITELIST_PREFIX.some((p) => path.startsWith(p))) {
    return next();
  }

  const token = getCookie(request, COOKIE_NAME);
  if (await verifyToken(token)) {
    return next();
  }

  // Unauthenticated: APIs get 401 JSON, pages get 302 to login.
  if (path.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const redirect = encodeURIComponent(path + url.search);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/login?redirect=${redirect}`,
      'Cache-Control': 'no-store',
    },
  });
}
