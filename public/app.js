// 段子铺前端：无框架，hash 路由
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
let me = null;
let price = 600;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const yuan = (c) => '¥' + (c / 100).toFixed(c % 100 ? 2 : 0);
const time = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '');

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

async function api(path, { method = 'GET', data } = {}) {
  const opts = { method, headers: {} };
  if (data !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  const res = await fetch('/api' + path, opts);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && me) {
      // 登录过期：回到登录页
      me = null;
      location.hash = '#/login';
    }
    throw new Error(out.error || '出错了');
  }
  return out;
}

// 把图片压缩到 D1 单行能放下的大小：最长边 800px，JPEG，必要时逐步降质量/尺寸
async function compressImage(file, maxChars = 300_000) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('图片读不出来，换一张试试'));
      i.src = url;
    });
    let side = 800;
    for (let attempt = 0; attempt < 8; attempt++) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // 透明 PNG 转 JPEG 时垫白底，二维码才扫得出
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      for (const q of [0.85, 0.7, 0.55]) {
        const data = canvas.toDataURL('image/jpeg', q);
        if (data.length <= maxChars) return data;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error('图片太大，压缩不下来，换一张试试');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderNav() {
  const route = location.hash.split('?')[0] || '#/';
  const links = me
    ? [['#/', '广场'], ['#/submit', '投稿'], ['#/mine', '我的投稿'], ['#/bought', '我买的'], ['#/me', '我的']]
    : [['#/login', '登录'], ['#/register', '注册']];
  if (me?.role === 'admin') links.splice(0, links.length, ['#/admin', '管理'], ['#/me', '收款码']);
  $nav.innerHTML =
    links.map(([h, t]) => `<a href="${h}" class="${route === h ? 'on' : ''}">${t}</a>`).join('') +
    (me ? `<a href="#" id="logout">退出</a>` : '');
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = async (e) => {
    e.preventDefault();
    await api('/logout', { method: 'POST' }).catch(() => {});
    me = null;
    location.hash = '#/login';
  };
}

async function loadMe() {
  try {
    me = (await api('/me')).user;
  } catch {
    me = null;
  }
}

const routes = {
  '#/login': viewLogin,
  '#/register': viewRegister,
  '#/': viewMarket,
  '#/submit': viewSubmit,
  '#/mine': viewMine,
  '#/bought': viewBought,
  '#/me': viewMe,
  '#/admin': viewAdmin,
};

async function router() {
  let route = location.hash.split('?')[0] || '#/';
  if (!routes[route]) route = '#/';
  if (!me && route !== '#/login' && route !== '#/register') route = '#/login';
  if (me && (route === '#/login' || route === '#/register')) route = me.role === 'admin' ? '#/admin' : '#/';
  if (me?.role === 'admin' && !['#/admin', '#/me'].includes(route)) route = '#/admin';
  if (location.hash.split('?')[0] !== route) {
    location.hash = route;
    return;
  }
  renderNav();
  try {
    await routes[route]();
  } catch (e) {
    $app.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

function bindForm(form, handler) {
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };
}

// ---------- 登录注册 ----------

function viewLogin() {
  $app.innerHTML = `
    <h2>登录</h2>
    <form class="card" id="f">
      <label>手机号或邮箱</label><input name="account" autocomplete="username" required>
      <label>密码</label><input name="password" type="password" autocomplete="current-password" required>
      <div class="row"><button type="submit">登录</button><a href="#/register" class="muted">没有账号？注册</a></div>
    </form>`;
  bindForm(document.getElementById('f'), async (d) => {
    await api('/login', { method: 'POST', data: d });
    await loadMe();
    location.hash = me.role === 'admin' ? '#/admin' : '#/';
  });
}

function viewRegister() {
  $app.innerHTML = `
    <h2>注册</h2>
    <form class="card" id="f">
      <label>手机号或邮箱</label><input name="account" autocomplete="username" required>
      <label>昵称（展示在你的段子上）</label><input name="name" maxlength="20" required>
      <label>密码（至少 6 位）</label><input name="password" type="password" minlength="6" autocomplete="new-password" required>
      <div class="row"><button type="submit">注册</button><a href="#/login" class="muted">已有账号？登录</a></div>
    </form>`;
  bindForm(document.getElementById('f'), async (d) => {
    await api('/register', { method: 'POST', data: d });
    await loadMe();
    toast('注册成功');
    location.hash = '#/';
  });
}

// ---------- 广场 / 下单 ----------

async function viewMarket() {
  const { pieces, price_cents } = await api('/pieces');
  price = price_cents;
  $app.innerHTML = `
    <h2>段子广场 <span class="meta">每条 <span class="price">${yuan(price)}</span>，买下后独享全文</span></h2>
    ${pieces.length ? '' : '<p class="muted">还没有在售的段子。</p>'}
    ${pieces
      .map(
        (p) => `
      <div class="card">
        <h3>${esc(p.title)}</h3>
        <div class="preview">${esc(p.preview)}…</div>
        <div class="row">
          <span class="meta">作者 ${esc(p.author)}</span>
          ${p.mine ? '<span class="tag">我的</span>' : `<button data-buy="${p.id}">${yuan(price)} 买下</button>`}
        </div>
      </div>`,
      )
      .join('')}`;
  $app.querySelectorAll('[data-buy]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`确定花 ${yuan(price)} 买下这条？下单后请扫码付款。`)) return;
      b.disabled = true;
      try {
        const { order } = await api(`/pieces/${b.dataset.buy}/order`, { method: 'POST' });
        toast(`下单成功，订单号 ${order.id}`);
        location.hash = '#/bought';
      } catch (e) {
        toast(e.message);
        viewMarket();
      }
    };
  });
}

async function viewBought() {
  const [{ orders }, { qr }] = await Promise.all([api('/orders/mine'), api('/pay-qr')]);
  const pending = orders.some((o) => o.status === 'pending');
  $app.innerHTML = `
    <h2>我买的</h2>
    ${
      pending
        ? `<div class="card"><b>待付款</b>：请扫下面的码付款，<b>备注里写订单号</b>。管理员确认收款后就能看到全文。
           ${qr ? `<img class="qr" src="${qr}" alt="收款码">` : '<p class="muted">管理员还没上传收款码，请联系管理员。</p>'}</div>`
        : ''
    }
    ${orders.length ? '' : '<p class="muted">还没买过段子，去<a href="#/">广场</a>看看。</p>'}
    ${orders
      .map(
        (o) => `
      <div class="card">
        <h3>${esc(o.title)}</h3>
        <div class="meta">订单号 ${o.id} · 作者 ${esc(o.author)} · ${yuan(o.amount_cents)} · ${time(o.created_at)}</div>
        ${
          o.status === 'paid'
            ? `<span class="tag ok">已付款</span><div class="full">${esc(o.content)}</div>`
            : o.status === 'pending'
              ? `<span class="tag warn">等管理员确认收款</span><div class="preview">${esc(o.preview)}…</div>
                 <div class="row"><button class="ghost" data-cancel="${o.id}">取消订单</button></div>`
              : `<span class="tag">已取消</span>`
        }
      </div>`,
      )
      .join('')}`;
  $app.querySelectorAll('[data-cancel]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('取消这个订单？')) return;
      try {
        await api(`/orders/${b.dataset.cancel}/cancel`, { method: 'POST' });
        viewBought();
      } catch (e) {
        toast(e.message);
      }
    };
  });
}

// ---------- 投稿 ----------

function viewSubmit() {
  $app.innerHTML = `
    <h2>投稿</h2>
    <form class="card" id="f">
      <label>标题</label><input name="title" maxlength="60" required>
      <label>开头（公开展示，用来吸引买家）</label><textarea name="preview" maxlength="300" required></textarea>
      <label>全文（买家付款后才能看到）</label><textarea name="content" maxlength="5000" style="min-height:160px" required></textarea>
      <p class="meta">提交后由管理员审核，通过后上架。每条卖出后会按你的收款码结算，记得在“我的”里上传收款码。</p>
      <div class="row"><button type="submit">提交审核</button></div>
    </form>`;
  bindForm(document.getElementById('f'), async (d) => {
    await api('/pieces', { method: 'POST', data: d });
    toast('已提交，等待审核');
    location.hash = '#/mine';
  });
}

async function viewMine() {
  const { pieces } = await api('/pieces/mine');
  const status = (p) => {
    if (p.status === 'pending') return '<span class="tag">审核中</span>';
    if (p.status === 'rejected') return '<span class="tag">未通过</span>';
    if (p.order_status === 'paid')
      return p.settled_at
        ? `<span class="tag ok">已卖出 · 已结算 ${yuan(p.author_cents)}</span>`
        : `<span class="tag warn">已卖出 · 待结算 ${yuan(p.author_cents)}</span>`;
    if (p.order_status === 'pending') return '<span class="tag warn">有人下单，等待付款</span>';
    return '<span class="tag ok">在售</span>';
  };
  $app.innerHTML = `
    <h2>我的投稿</h2>
    ${me.has_qr ? '' : '<div class="card">还没上传收款码，卖出后没法给你结算。<a href="#/me">去上传</a></div>'}
    ${pieces.length ? '' : '<p class="muted">还没投过稿，<a href="#/submit">去投稿</a>。</p>'}
    ${pieces
      .map(
        (p) => `
      <div class="card">
        <h3>${esc(p.title)}</h3>
        <div class="row" style="margin-top:0">${status(p)}<span class="meta">${time(p.created_at)}</span></div>
        <details><summary class="meta">看全文</summary><div class="full">${esc(p.content)}</div></details>
      </div>`,
      )
      .join('')}`;
}

// ---------- 我的 / 收款码 ----------

async function viewMe() {
  const { qr } = await api('/me/qr');
  const isAdmin = me.role === 'admin';
  $app.innerHTML = `
    <h2>${isAdmin ? '平台收款码' : '我的'}</h2>
    <div class="card">
      <div>${esc(me.name)} <span class="meta">${esc(me.account)}</span></div>
      <p class="meta">${isAdmin ? '买家下单后会看到这张码，用来付款给你。' : '卖出段子后，管理员会扫这张码给你结算。'}</p>
      ${qr ? `<img class="qr" id="qrimg" src="${qr}" alt="收款码">` : '<p class="muted" id="qrimg">还没上传收款码</p>'}
      <label>上传${qr ? '新的' : ''}微信或支付宝收款码</label>
      <input type="file" id="qrfile" accept="image/*">
      <div class="row"><button id="qrup" disabled>上传</button><span class="meta" id="qrinfo"></span></div>
    </div>`;
  const file = document.getElementById('qrfile');
  const up = document.getElementById('qrup');
  const info = document.getElementById('qrinfo');
  let data = null;
  file.onchange = async () => {
    data = null;
    up.disabled = true;
    if (!file.files[0]) return;
    info.textContent = '压缩中…';
    try {
      data = await compressImage(file.files[0]);
      info.textContent = `已压缩：${Math.round(file.files[0].size / 1024)}KB → ${Math.round((data.length * 3) / 4 / 1024)}KB`;
      up.disabled = false;
    } catch (e) {
      info.textContent = '';
      toast(e.message);
    }
  };
  up.onclick = async () => {
    if (!data) return;
    up.disabled = true;
    try {
      await api('/me/qr', { method: 'POST', data: { image: data } });
      me.has_qr = true;
      toast('收款码已保存');
      viewMe();
    } catch (e) {
      toast(e.message);
      up.disabled = false;
    }
  };
}

// ---------- 管理 ----------

let adminTab = 'review';

async function viewAdmin() {
  const { stats } = await api('/admin/stats');
  const tabs = [
    ['review', `审核 (${stats.pending_pieces})`],
    ['orders', `待收款 (${stats.pending_orders})`],
    ['paid', '已付款'],
    ['settle', '结算'],
  ];
  $app.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${stats.users}</b><span>用户</span></div>
      <div class="stat"><b>${stats.paid_orders}</b><span>已卖出</span></div>
      <div class="stat"><b>${yuan(stats.income_cents)}</b><span>总收款</span></div>
      <div class="stat"><b>${stats.pending_orders}</b><span>待收款</span></div>
      <div class="stat"><b>${stats.pending_pieces}</b><span>待审核</span></div>
      <div class="stat"><b>${yuan(stats.unsettled_cents)}</b><span>待结算</span></div>
    </div>
    <div class="tabs">${tabs.map(([k, t]) => `<button data-tab="${k}" class="${adminTab === k ? 'on' : ''}">${t}</button>`).join('')}
      <a class="btn ghost" href="/api/admin/export.csv">导出 CSV</a></div>
    <div id="panel"><p class="muted">加载中…</p></div>`;
  $app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => ((adminTab = b.dataset.tab), viewAdmin())));
  const panel = document.getElementById('panel');
  await { review: adminReview, orders: adminOrders, paid: adminPaid, settle: adminSettle }[adminTab](panel);
}

async function act(path, data, okMsg) {
  try {
    await api(path, { method: 'POST', data: data ?? {} });
    if (okMsg) toast(okMsg);
  } catch (e) {
    toast(e.message);
  }
  viewAdmin();
}

async function adminReview(panel) {
  const { pieces } = await api('/admin/pieces?status=pending');
  panel.innerHTML = pieces.length
    ? pieces
        .map(
          (p) => `
      <div class="card">
        <h3>${esc(p.title)}</h3>
        <div class="meta">${esc(p.author)}（${esc(p.author_account)}） · ${time(p.created_at)}</div>
        <div class="preview"><b>开头：</b>${esc(p.preview)}</div>
        <div class="full">${esc(p.content)}</div>
        <div class="row"><button data-ok="${p.id}">通过</button><button class="ghost" data-no="${p.id}">不通过</button></div>
      </div>`,
        )
        .join('')
    : '<p class="muted">没有待审核的投稿。</p>';
  panel.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => act(`/admin/pieces/${b.dataset.ok}/review`, { action: 'approve' }, '已上架')));
  panel.querySelectorAll('[data-no]').forEach((b) => (b.onclick = () => act(`/admin/pieces/${b.dataset.no}/review`, { action: 'reject' }, '已拒绝')));
}

async function adminOrders(panel) {
  const { orders } = await api('/admin/orders?status=pending');
  panel.innerHTML = orders.length
    ? `<p class="meta">核对收款记录里的备注订单号和金额，收到了再点“确认收款”。</p>` +
      orders
        .map(
          (o) => `
      <div class="card">
        <h3>订单号 ${o.id} · ${yuan(o.amount_cents)}</h3>
        <div class="meta">《${esc(o.title)}》 · 买家 ${esc(o.buyer)}（${esc(o.buyer_account)}） · ${time(o.created_at)}</div>
        <div class="row"><button data-confirm="${o.id}">确认收款</button><button class="ghost" data-cancel="${o.id}">取消订单</button></div>
      </div>`,
        )
        .join('')
    : '<p class="muted">没有待确认收款的订单。</p>';
  panel.querySelectorAll('[data-confirm]').forEach((b) => (b.onclick = () => confirm(`确认已收到订单 ${b.dataset.confirm} 的款？`) && act(`/admin/orders/${b.dataset.confirm}/confirm`, null, '已确认，买家能看到全文了')));
  panel.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => confirm('取消后段子重新上架，确定？') && act(`/admin/orders/${b.dataset.cancel}/cancel`, null, '已取消')));
}

async function adminPaid(panel) {
  const { orders } = await api('/admin/orders?status=paid');
  panel.innerHTML = orders.length
    ? orders
        .map(
          (o) => `
      <div class="card">
        <h3>订单号 ${o.id} · ${yuan(o.amount_cents)}</h3>
        <div class="meta">《${esc(o.title)}》 · 作者 ${esc(o.author)} · 买家 ${esc(o.buyer)} · 收款 ${time(o.paid_at)}</div>
        ${o.settled_at ? `<span class="tag ok">已结算 ${time(o.settled_at)}</span>` : '<span class="tag warn">待结算</span>'}
      </div>`,
        )
        .join('')
    : '<p class="muted">还没有已付款的订单。</p>';
}

async function adminSettle(panel) {
  const { authors } = await api('/admin/settlements');
  panel.innerHTML = authors.length
    ? `<p class="meta">扫作者的收款码付款，付完点“已结算”。</p>` +
      authors
        .map(
          (a) => `
      <div class="card">
        <h3>${esc(a.name)} · 应结 <span class="price">${yuan(a.total_cents)}</span></h3>
        <div class="meta">${esc(a.account)} · ${a.count} 条 · 订单号 ${a.order_ids.join('、')}</div>
        ${a.qr ? `<img class="qr" src="${a.qr}" alt="收款码">` : '<p class="muted">作者还没上传收款码，请联系作者。</p>'}
        <div class="row"><button data-settle="${a.author_id}" data-ids="${a.order_ids.join(',')}">已结算 ${yuan(a.total_cents)}</button></div>
      </div>`,
        )
        .join('')
    : '<p class="muted">没有待结算的款项。</p>';
  panel.querySelectorAll('[data-settle]').forEach(
    (b) =>
      (b.onclick = () =>
        confirm('确认已经付给作者了？') &&
        act(`/admin/settlements/${b.dataset.settle}`, { order_ids: b.dataset.ids.split(',').map(Number) }, '已标记结算')),
  );
}

window.addEventListener('hashchange', router);
(async () => {
  await loadMe();
  router();
})();
