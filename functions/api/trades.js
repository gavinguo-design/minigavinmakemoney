// Cloudflare Pages Function: /api/trades — 交易战绩站内编辑
//
// 架构说明（重要）：
//   本仓库是 PUBLIC 仓库，因此 GitHub token 绝不能出现在代码里，
//   Cloudflare 侧也没有可用的 secret 存储（无 wrangler / KV 绑定）。
//   方案（双通道，优先级从高到低）：
//   1) Pages 环境变量 GH_TOKEN（若后续在 CF Dashboard → Pages 项目 →
//      Settings → Environment variables 里配置了，则自动生效，页面无需再设）
//   2) 浏览器把 token 存在 localStorage（用户设置一次），每次写请求通过
//      X-GH-Token header 传给本 Function 代理 GitHub Contents API。
//   Token 只在传输中出现（HTTPS），不落盘、不入库、不进代码。
//
//   GET  /api/trades   → 从 GitHub 实时读 trades.json（绕过 Pages 部署延迟）
//                         有 X-GH-Token 用 Contents API（新鲜、限额高），
//                         无 token 回退 raw.githubusercontent.com。
//   POST /api/trades   → { action: add|close|edit|delete, ... }
//                         更新 trades.json 并重算 stats，commit 到 main。
//
// 本路径不在 _middleware.js 白名单内，受整站 cookie 登录门禁保护。

const OWNER = 'gavinguo-design';
const REPO = 'minigavinmakemoney';
const BRANCH = 'main';
const FILE_PATH = 'investment/chart/trades.json';
const GH_API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/`;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function ghHeaders(token) {
  const h = {
    'User-Agent': 'minigavin-pages-fn',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `token ${token}`;
  return h;
}

function b64DecodeUtf8(b64) {
  const clean = b64.replace(/\s/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function b64EncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function ghGetFile(path, token) {
  const res = await fetch(`${GH_API}${path}?ref=${BRANCH}&ts=${Date.now()}`, {
    headers: ghHeaders(token),
  });
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

// ---- domain logic ----

function round2(n) {
  return Math.round(n * 100) / 100;
}

// 从自由文本仓位里解析数字（"3手" → 3, "2.5万" 不乘万只取 2.5, 解析不了 → null）
function parseQty(size) {
  if (size === null || size === undefined || size === '') return null;
  const m = String(size).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function computePnl(t) {
  const o = Number(t.openPrice);
  const c = Number(t.closePrice);
  if (!isFinite(o) || !isFinite(c)) {
    t.pnl = null;
    t.pnlPct = null;
    return;
  }
  let diff = c - o;
  if (t.direction === 'short') diff = -diff;
  const qty = parseQty(t.size);
  // 数量能解析就乘，解析不了就按点数/价差记
  t.pnl = round2(qty !== null && qty !== 0 ? diff * qty : diff);
  t.pnlPct = o !== 0 ? round2((diff / o) * 100) : null;
}

function recalcStats(trades) {
  const closed = trades.filter((t) => t.status === 'closed');
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  const losses = closed.filter((t) => (t.pnl ?? 0) < 0).length;
  return {
    total: trades.length,
    wins,
    losses,
    winRate: closed.length ? round2((wins / closed.length) * 100) : null,
    totalPnl: closed.length ? round2(closed.reduce((a, t) => a + (t.pnl || 0), 0)) : null,
  };
}

function makeId() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // Asia/Shanghai
  const p = (n) => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return `T${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${rand}`;
}

const EDITABLE = ['symbol', 'name', 'direction', 'openDate', 'openPrice', 'size', 'note', 'closeDate', 'closePrice'];

function applyAction(data, body) {
  const trades = Array.isArray(data.trades) ? data.trades : [];
  const action = body.action;

  if (action === 'add') {
    const t = body.trade || {};
    if (!t.symbol) throw new Error('symbol required');
    const trade = {
      id: makeId(),
      status: 'open',
      symbol: String(t.symbol).trim(),
      name: t.name ? String(t.name).trim() : '',
      direction: t.direction === 'short' ? 'short' : 'long',
      openDate: t.openDate || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
      openPrice: t.openPrice !== undefined && t.openPrice !== '' ? Number(t.openPrice) : null,
      size: t.size || '',
      note: t.note || '',
      pnl: null,
      pnlPct: null,
    };
    trades.push(trade);
    return { trades, msg: `trades: add ${trade.symbol} (${trade.id}) via site`, id: trade.id };
  }

  const idx = trades.findIndex((t) => t.id === body.id);
  if (idx === -1) throw new Error(`trade not found: ${body.id}`);
  const tr = trades[idx];

  if (action === 'close') {
    tr.status = 'closed';
    tr.closeDate = body.closeDate || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    tr.closePrice = body.closePrice !== undefined && body.closePrice !== '' ? Number(body.closePrice) : null;
    computePnl(tr);
    return { trades, msg: `trades: close ${tr.symbol} (${tr.id}) pnl=${tr.pnl} via site`, id: tr.id };
  }

  if (action === 'edit') {
    const f = body.fields || {};
    for (const k of EDITABLE) {
      if (k in f) tr[k] = f[k];
    }
    if (tr.openPrice !== null && tr.openPrice !== '' && tr.openPrice !== undefined) tr.openPrice = Number(tr.openPrice);
    if (tr.status === 'closed') {
      if (tr.closePrice !== null && tr.closePrice !== '' && tr.closePrice !== undefined) tr.closePrice = Number(tr.closePrice);
      computePnl(tr);
    }
    return { trades, msg: `trades: edit ${tr.symbol} (${tr.id}) via site`, id: tr.id };
  }

  if (action === 'delete') {
    trades.splice(idx, 1);
    return { trades, msg: `trades: delete ${tr.symbol} (${tr.id}) via site`, id: tr.id };
  }

  throw new Error(`unknown action: ${action}`);
}

// ---- handlers ----

export async function onRequestGet(context) {
  const token = context.env?.GH_TOKEN || context.request.headers.get('X-GH-Token') || '';
  try {
    if (token) {
      const { text } = await ghGetFile(FILE_PATH, token);
      if (text === null) return json({ trades: [], stats: recalcStats([]) });
      return json(JSON.parse(text));
    }
    // 无 token：回退公共 raw（仓库公开可读），带时间戳绕 CDN 缓存
    const res = await fetch(
      `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${FILE_PATH}?ts=${Date.now()}`,
      { headers: { 'User-Agent': 'minigavin-pages-fn' } }
    );
    if (!res.ok) throw new Error(`raw fetch ${res.status}`);
    return json(await res.json());
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}

export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }

  const token = context.env?.GH_TOKEN || request.headers.get('X-GH-Token') || body.ghToken || '';
  if (!token) {
    return json({ error: 'missing github token — 页面右上角 ⚙️ 设置一次即可', needToken: true }, 400);
  }

  // 带一次 409 冲突重试的读-改-写
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { sha, text } = await ghGetFile(FILE_PATH, token);
      const data = text ? JSON.parse(text) : { trades: [], stats: {} };
      const { trades, msg, id } = applyAction(data, body);
      const out = { trades, stats: recalcStats(trades) };
      await ghPutFile(FILE_PATH, b64EncodeUtf8(JSON.stringify(out, null, 2) + '\n'), msg, sha, token);
      return json({ ok: true, id, data: out });
    } catch (e) {
      if (e.status === 409 && attempt === 0) continue; // sha 冲突，重读重写一次
      const status = e.status === 401 ? 401 : 500;
      return json({ error: String(e.message || e) }, status);
    }
  }
  return json({ error: 'conflict retry exhausted' }, 500);
}
