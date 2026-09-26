// Cloudflare Pages Function: POST /api/upload — 交割截图上传
//
// 接收截图（multipart form-data 的 file 字段，或 JSON { imageB64, filename }），
// 通过 GitHub Contents API commit 到 investment/chart/uploads/YYYYMMDD-HHMMSS.<ext>，
// 并在 investment/chart/uploads/pending.json 追加一条待识别记录：
//   { "file": "investment/chart/uploads/20260926-150301.jpg",
//     "uploadedAt": "2026-09-26T15:03:01+08:00",
//     "status": "pending" }
// 识别端（Mac mini cron 视觉模型）处理后将 status 改为 processed 并更新 trades.json。
//
// Token 通道与 /api/trades 相同：env.GH_TOKEN 优先，其次 X-GH-Token header。
// 本路径不在 _middleware.js 白名单内，受整站 cookie 登录门禁保护。

const OWNER = 'gavinguo-design';
const REPO = 'minigavinmakemoney';
const BRANCH = 'main';
const UPLOAD_DIR = 'investment/chart/uploads';
const PENDING_PATH = `${UPLOAD_DIR}/pending.json`;
const GH_API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/`;
const MAX_BYTES = 4 * 1024 * 1024; // 4MB

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function ghHeaders(token) {
  return {
    'User-Agent': 'minigavin-pages-fn',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `token ${token}`,
  };
}

function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64DecodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function b64EncodeUtf8(text) {
  return bytesToB64(new TextEncoder().encode(text));
}

async function ghGetFile(path, token) {
  const res = await fetch(`${GH_API}${path}?ref=${BRANCH}&ts=${Date.now()}`, { headers: ghHeaders(token) });
  if (res.status === 404) return { sha: null, text: null };
  if (!res.ok) throw new Error(`GitHub GET ${path} → ${res.status}`);
  const d = await res.json();
  return { sha: d.sha, text: b64DecodeUtf8(d.content || '') };
}

async function ghPutFile(path, contentB64, message, sha, token) {
  const body = { message, content: contentB64, branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(GH_API + path, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`GitHub PUT ${path} → ${res.status}: ${t.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function extFromType(mime, fallbackName) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' };
  if (mime && map[mime]) return map[mime];
  const m = String(fallbackName || '').match(/\.(jpe?g|png|webp|gif|heic)$/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

function nowShanghai() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    stamp: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`,
    iso: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+08:00`,
  };
}

export async function onRequestPost(context) {
  const { request } = context;
  const token = context.env?.GH_TOKEN || request.headers.get('X-GH-Token') || '';
  if (!token) return json({ error: 'missing github token — 页面右上角 ⚙️ 设置一次即可', needToken: true }, 400);

  let bytes = null;
  let mime = '';
  let origName = '';
  let note = '';

  const ct = request.headers.get('Content-Type') || '';
  try {
    if (ct.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return json({ error: 'file field required' }, 400);
      mime = file.type || '';
      origName = file.name || '';
      note = String(form.get('note') || '');
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const body = await request.json();
      if (!body.imageB64) return json({ error: 'imageB64 required' }, 400);
      const b64 = body.imageB64.replace(/^data:([^;]+);base64,/, (_, m) => { mime = m; return ''; });
      const bin = atob(b64.replace(/\s/g, ''));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      origName = body.filename || '';
      note = body.note || '';
    }
  } catch (e) {
    return json({ error: 'bad request body: ' + String(e.message || e) }, 400);
  }

  if (!bytes || !bytes.length) return json({ error: 'empty file' }, 400);
  if (bytes.length > MAX_BYTES) {
    return json({ error: `图片超过 4MB（${(bytes.length / 1048576).toFixed(1)}MB），请压缩后重试` }, 413);
  }

  const { stamp, iso } = nowShanghai();
  const ext = extFromType(mime, origName);
  const filePath = `${UPLOAD_DIR}/${stamp}.${ext}`;

  try {
    // 1) commit 图片
    await ghPutFile(filePath, bytesToB64(bytes), `uploads: screenshot ${stamp} via site`, null, token);

    // 2) 追加 pending.json（带一次 409 重试）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { sha, text } = await ghGetFile(PENDING_PATH, token);
        let list = [];
        if (text) {
          try { list = JSON.parse(text); } catch { list = []; }
        }
        if (!Array.isArray(list)) list = [];
        const entry = { file: filePath, uploadedAt: iso, status: 'pending' };
        if (note) entry.note = note;
        list.push(entry);
        await ghPutFile(PENDING_PATH, b64EncodeUtf8(JSON.stringify(list, null, 2) + '\n'), `uploads: pending +${stamp}`, sha, token);
        break;
      } catch (e) {
        if (e.status === 409 && attempt === 0) continue;
        throw e;
      }
    }

    return json({ ok: true, file: filePath, uploadedAt: iso });
  } catch (e) {
    const status = e.status === 401 ? 401 : 500;
    return json({ error: String(e.message || e) }, status);
  }
}
