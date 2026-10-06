// 段子铺 Cloudflare Worker：/api/* 走这里，其余由静态资源（public/）提供

const SESSION_DAYS = 30;
const MAX_QR_CHARS = 400_000; // 压缩后的收款码 data URL 上限（D1 单行上限 2MB，留足余量）
const LIMITS = { title: 60, preview: 300, content: 5000, name: 20 };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handle(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: '服务器出错了，请稍后再试' }, 500);
    }
  },
};

// ---------- 工具 ----------

const now = () => Date.now();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return hex(bits);
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function normalizeAccount(raw) {
  const s = String(raw ?? '').trim();
  if (/^1\d{10}$/.test(s)) return s;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 100) return s.toLowerCase();
  fail(400, '请填写 11 位手机号或邮箱');
}

function text(raw, field, label) {
  const s = String(raw ?? '').trim();
  if (!s) fail(400, `${label}不能为空`);
  if ([...s].length > LIMITS[field]) fail(400, `${label}最多 ${LIMITS[field]} 字`);
  return s;
}

async function body(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) fail(415, '请求格式不对');
  try {
    return await request.json();
  } catch {
    fail(400, '请求格式不对');
  }
}

function priceCents(env) {
  return parseInt(env.PRICE_CENTS || '600', 10);
}
function authorCents(env) {
  const pct = Math.min(100, Math.max(0, parseInt(env.AUTHOR_SHARE_PERCENT || '100', 10)));
  return Math.round((priceCents(env) * pct) / 100);
}

// ---------- 登录态 ----------

function readCookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function currentUser(request, env) {
  const token = readCookie(request, 'sid');
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.account, u.name, u.role, (u.qr IS NOT NULL) AS has_qr
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first();
}

async function startSession(request, env, userId, status = 200, data = {}) {
  const token = randomHex(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(
      await sha256(token),
      userId,
      now() + SESSION_DAYS * 86400_000,
    ),
  ]);
  return json(data, status, { 'set-cookie': sessionCookie(request, token, SESSION_DAYS * 86400) });
}

// ---------- 路由 ----------

async function handle(request, env, url) {
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, '');
  const parts = path.split('/').slice(2); // ['pieces', '12', 'order']

  // 公开接口
  if (method === 'POST' && path === '/api/register') return register(request, env);
  if (method === 'POST' && path === '/api/login') return login(request, env);
  if (method === 'POST' && path === '/api/logout') {
    const token = readCookie(request, 'sid');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
  }
  if (method === 'GET' && path === '/api/config') return json({ price_cents: priceCents(env) });

  const user = await currentUser(request, env);
  if (!user) fail(401, '请先登录');
  const isAdmin = user.role === 'admin';

  if (method === 'GET' && path === '/api/me') return json({ user: { ...user, has_qr: !!user.has_qr } });
  if (method === 'GET' && path === '/api/me/qr') {
    const row = await env.DB.prepare('SELECT qr FROM users WHERE id = ?').bind(user.id).first();
    return json({ qr: row?.qr ?? null });
  }
  if (method === 'POST' && path === '/api/me/qr') return uploadQr(request, env, user);

  if (method === 'GET' && path === '/api/pieces') return market(env, user);
  if (method === 'POST' && path === '/api/pieces') return submitPiece(request, env, user);
  if (method === 'GET' && path === '/api/pieces/mine') return myPieces(env, user);
  if (parts[0] === 'pieces' && /^\d+$/.test(parts[1] || '')) {
    const id = Number(parts[1]);
    if (method === 'GET' && parts.length === 2) return pieceDetail(env, user, id);
    if (method === 'POST' && parts[2] === 'order' && parts.length === 3) return placeOrder(env, user, id);
  }

  if (method === 'GET' && path === '/api/orders/mine') return myOrders(env, user);
  if (method === 'POST' && parts[0] === 'orders' && /^\d+$/.test(parts[1] || '') && parts[2] === 'cancel') {
    return cancelOrder(env, user, Number(parts[1]), isAdmin);
  }
  if (method === 'GET' && path === '/api/pay-qr') {
    const row = await env.DB.prepare("SELECT qr FROM users WHERE role = 'admin' AND qr IS NOT NULL ORDER BY id LIMIT 1").first();
    return json({ qr: row?.qr ?? null });
  }

  if (parts[0] === 'admin') {
    if (!isAdmin) fail(403, '只有管理员能操作');
    return admin(request, env, url, method, parts.slice(1));
  }

  fail(404, '接口不存在');
}

// ---------- 账号 ----------

async function register(request, env) {
  const b = await body(request);
  const account = normalizeAccount(b.account);
  const name = text(b.name, 'name', '昵称');
  const password = String(b.password ?? '');
  if (password.length < 6 || password.length > 64) fail(400, '密码 6 到 64 位');
  if (env.ADMIN_ACCOUNT && account === normalizeAdmin(env)) fail(409, '这个账号已被注册');

  const salt = randomHex(16);
  const passHash = await hashPassword(password, salt);
  let row;
  try {
    row = await env.DB.prepare(
      'INSERT INTO users (account, name, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    )
      .bind(account, name, passHash, salt, now())
      .first();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) fail(409, '这个账号已被注册');
    throw e;
  }
  return startSession(request, env, row.id, 201, { ok: true });
}

function normalizeAdmin(env) {
  const s = String(env.ADMIN_ACCOUNT).trim();
  return s.includes('@') ? s.toLowerCase() : s;
}

async function login(request, env) {
  const b = await body(request);
  const account = normalizeAccount(b.account);
  const password = String(b.password ?? '');

  // 管理员账号和密码来自 Worker 密钥（ADMIN_ACCOUNT / ADMIN_PASSWORD），首次登录时自动建号
  if (env.ADMIN_ACCOUNT && env.ADMIN_PASSWORD && account === normalizeAdmin(env)) {
    if (!safeEqual(password, env.ADMIN_PASSWORD)) fail(401, '账号或密码不对');
    const salt = randomHex(16);
    const passHash = await hashPassword(password, salt);
    const row = await env.DB.prepare(
      `INSERT INTO users (account, name, pass_hash, salt, role, created_at) VALUES (?, '管理员', ?, ?, 'admin', ?)
       ON CONFLICT(account) DO UPDATE SET role = 'admin', pass_hash = excluded.pass_hash, salt = excluded.salt
       RETURNING id`,
    )
      .bind(account, passHash, salt, now())
      .first();
    return startSession(request, env, row.id, 200, { ok: true });
  }

  const u = await env.DB.prepare('SELECT id, pass_hash, salt, role FROM users WHERE account = ?').bind(account).first();
  // 账号不存在时也算一次哈希，避免靠响应时间猜账号
  const hash = await hashPassword(password, u?.salt ?? 'no-such-user');
  if (!u || !safeEqual(hash, u.pass_hash) || u.role === 'admin') fail(401, '账号或密码不对');
  return startSession(request, env, u.id, 200, { ok: true });
}

async function uploadQr(request, env, user) {
  const b = await body(request);
  const img = String(b.image ?? '');
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) fail(400, '图片格式不对，请上传 JPG 或 PNG');
  if (img.length > MAX_QR_CHARS) fail(413, '图片太大了，请换一张清晰度低一点的');
  await env.DB.prepare('UPDATE users SET qr = ? WHERE id = ?').bind(img, user.id).run();
  return json({ ok: true });
}

// ---------- 段子 ----------

async function market(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.preview, p.created_at, u.name AS author, (p.author_id = ?) AS mine
       FROM pieces p JOIN users u ON u.id = p.author_id
      WHERE p.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.piece_id = p.id AND o.status IN ('pending', 'paid'))
      ORDER BY p.reviewed_at DESC, p.id DESC
      LIMIT 200`,
  )
    .bind(user.id)
    .all();
  return json({ pieces: results.map((p) => ({ ...p, mine: !!p.mine })), price_cents: priceCents(env) });
}

async function submitPiece(request, env, user) {
  const b = await body(request);
  const title = text(b.title, 'title', '标题');
  const preview = text(b.preview, 'preview', '开头');
  const content = text(b.content, 'content', '全文');
  const row = await env.DB.prepare(
    'INSERT INTO pieces (author_id, title, preview, content, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(user.id, title, preview, content, now())
    .first();
  return json({ id: row.id }, 201);
}

async function myPieces(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.preview, p.content, p.status, p.created_at,
            o.status AS order_status, o.author_cents, o.settled_at
       FROM pieces p
       LEFT JOIN orders o ON o.piece_id = p.id AND o.status IN ('pending', 'paid')
      WHERE p.author_id = ?
      ORDER BY p.id DESC`,
  )
    .bind(user.id)
    .all();
  return json({ pieces: results });
}

async function pieceDetail(env, user, id) {
  const p = await env.DB.prepare(
    `SELECT p.*, u.name AS author FROM pieces p JOIN users u ON u.id = p.author_id WHERE p.id = ?`,
  )
    .bind(id)
    .first();
  if (!p) fail(404, '没有这条段子');
  const isAuthor = p.author_id === user.id;
  const isAdmin = user.role === 'admin';
  if (p.status !== 'approved' && !isAuthor && !isAdmin) fail(404, '没有这条段子');
  const paid = await env.DB.prepare("SELECT 1 FROM orders WHERE piece_id = ? AND buyer_id = ? AND status = 'paid'")
    .bind(id, user.id)
    .first();
  const canRead = isAuthor || isAdmin || !!paid;
  return json({
    piece: {
      id: p.id,
      title: p.title,
      preview: p.preview,
      author: p.author,
      status: p.status,
      created_at: p.created_at,
      content: canRead ? p.content : null,
    },
  });
}

async function placeOrder(env, user, pieceId) {
  const p = await env.DB.prepare('SELECT id, author_id, status FROM pieces WHERE id = ?').bind(pieceId).first();
  if (!p || p.status !== 'approved') fail(404, '没有这条段子');
  if (p.author_id === user.id) fail(400, '不能买自己的段子');
  if (user.role === 'admin') fail(400, '管理员账号不能下单');
  try {
    // orders_one_active 唯一索引保证同一条段子同时只有一个有效订单
    const row = await env.DB.prepare(
      `INSERT INTO orders (piece_id, buyer_id, amount_cents, author_cents, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id, amount_cents`,
    )
      .bind(pieceId, user.id, priceCents(env), authorCents(env), now())
      .first();
    return json({ order: row }, 201);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) fail(409, '手慢了，这条已经被人订走了');
    throw e;
  }
}

async function myOrders(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.status, o.amount_cents, o.created_at, o.paid_at,
            p.id AS piece_id, p.title, p.preview,
            CASE WHEN o.status = 'paid' THEN p.content END AS content,
            u.name AS author
       FROM orders o JOIN pieces p ON p.id = o.piece_id JOIN users u ON u.id = p.author_id
      WHERE o.buyer_id = ?
      ORDER BY o.id DESC`,
  )
    .bind(user.id)
    .all();
  return json({ orders: results });
}

async function cancelOrder(env, user, orderId, isAdmin) {
  const res = await env.DB.prepare(
    `UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending' AND (buyer_id = ? OR ?)`,
  )
    .bind(orderId, user.id, isAdmin ? 1 : 0)
    .run();
  if (!res.meta.changes) fail(404, '订单不存在或已不能取消');
  return json({ ok: true });
}

// ---------- 管理员 ----------

async function admin(request, env, url, method, parts) {
  const [section, idStr, action] = parts;
  const id = Number(idStr);

  if (method === 'GET' && section === 'stats') {
    const r = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role = 'user') AS users,
         (SELECT COUNT(*) FROM pieces WHERE status = 'pending') AS pending_pieces,
         (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders,
         (SELECT COUNT(*) FROM orders WHERE status = 'paid') AS paid_orders,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM orders WHERE status = 'paid') AS income_cents,
         (SELECT COALESCE(SUM(author_cents), 0) FROM orders WHERE status = 'paid' AND settled_at IS NULL) AS unsettled_cents`,
    ).first();
    return json({ stats: r });
  }

  if (method === 'GET' && section === 'pieces') {
    const status = url.searchParams.get('status') || 'pending';
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.title, p.preview, p.content, p.status, p.created_at, u.name AS author, u.account AS author_account
         FROM pieces p JOIN users u ON u.id = p.author_id WHERE p.status = ? ORDER BY p.id LIMIT 200`,
    )
      .bind(status)
      .all();
    return json({ pieces: results });
  }

  if (method === 'POST' && section === 'pieces' && id && action === 'review') {
    const b = await body(request);
    const to = b.action === 'approve' ? 'approved' : b.action === 'reject' ? 'rejected' : fail(400, '操作不对');
    const res = await env.DB.prepare(
      "UPDATE pieces SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'",
    )
      .bind(to, now(), id)
      .run();
    if (!res.meta.changes) fail(404, '这条已经审核过了');
    return json({ ok: true });
  }

  if (method === 'GET' && section === 'orders') {
    const status = url.searchParams.get('status') || 'pending';
    const { results } = await env.DB.prepare(
      `SELECT o.id, o.status, o.amount_cents, o.created_at, o.paid_at, o.settled_at,
              p.title, b.name AS buyer, b.account AS buyer_account, a.name AS author
         FROM orders o JOIN pieces p ON p.id = o.piece_id
         JOIN users b ON b.id = o.buyer_id JOIN users a ON a.id = p.author_id
        WHERE o.status = ? ORDER BY o.id DESC LIMIT 200`,
    )
      .bind(status)
      .all();
    return json({ orders: results });
  }

  if (method === 'POST' && section === 'orders' && id && action === 'confirm') {
    const res = await env.DB.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'")
      .bind(now(), id)
      .run();
    if (!res.meta.changes) fail(404, '订单不存在或已处理');
    return json({ ok: true });
  }

  if (method === 'POST' && section === 'orders' && id && action === 'cancel') {
    const res = await env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'")
      .bind(id)
      .run();
    if (!res.meta.changes) fail(404, '订单不存在或已处理');
    return json({ ok: true });
  }

  if (method === 'GET' && section === 'settlements') {
    const { results } = await env.DB.prepare(
      `SELECT a.id AS author_id, a.name, a.account, a.qr,
              COUNT(o.id) AS count, SUM(o.author_cents) AS total_cents, GROUP_CONCAT(o.id) AS order_ids
         FROM orders o JOIN pieces p ON p.id = o.piece_id JOIN users a ON a.id = p.author_id
        WHERE o.status = 'paid' AND o.settled_at IS NULL
        GROUP BY a.id ORDER BY total_cents DESC`,
    ).all();
    return json({
      authors: results.map((r) => ({ ...r, order_ids: String(r.order_ids).split(',').map(Number) })),
    });
  }

  if (method === 'POST' && section === 'settlements' && id) {
    // 只结算管理员页面上看到的那几笔，避免期间新确认的订单被一并标记
    const b = await body(request);
    const ids = (Array.isArray(b.order_ids) ? b.order_ids : []).map(Number).filter(Number.isInteger);
    if (!ids.length || ids.length > 500) fail(400, '没有要结算的订单');
    const res = await env.DB.prepare(
      `UPDATE orders SET settled_at = ?
        WHERE id IN (${ids.map(() => '?').join(',')}) AND status = 'paid' AND settled_at IS NULL
          AND piece_id IN (SELECT id FROM pieces WHERE author_id = ?)`,
    )
      .bind(now(), ...ids, id)
      .run();
    return json({ settled: res.meta.changes });
  }

  if (method === 'GET' && section === 'export.csv') {
    const { results } = await env.DB.prepare(
      `SELECT o.id, o.created_at, o.status, o.amount_cents, o.author_cents, o.paid_at, o.settled_at,
              p.id AS piece_id, p.title, a.name AS author, a.account AS author_account, b.name AS buyer, b.account AS buyer_account
         FROM orders o JOIN pieces p ON p.id = o.piece_id
         JOIN users a ON a.id = p.author_id JOIN users b ON b.id = o.buyer_id
        ORDER BY o.id`,
    ).all();
    const statusName = { pending: '待确认收款', paid: '已付款', cancelled: '已取消' };
    const header = ['订单号', '下单时间', '状态', '金额(元)', '作者应得(元)', '确认收款时间', '结算时间', '段子ID', '标题', '作者', '作者账号', '买家', '买家账号'];
    const rows = results.map((r) => [
      r.id, fmtTime(r.created_at), statusName[r.status] || r.status, (r.amount_cents / 100).toFixed(2),
      (r.author_cents / 100).toFixed(2), fmtTime(r.paid_at), fmtTime(r.settled_at), r.piece_id, r.title,
      r.author, r.author_account, r.buyer, r.buyer_account,
    ]);
    const csv = '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="duanzipu-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  fail(404, '接口不存在');
}

function fmtTime(ms) {
  if (!ms) return '';
  // 北京时间
  return new Date(ms + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
}

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 防止 Excel 把内容当公式执行
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
