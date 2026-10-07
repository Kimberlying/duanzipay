import { $app, $nav, me, setMe, esc, yuan, time, toast, api, compressImage, loadMe, bindForm, heading, emptyState } from './core.js';
import { viewLogin, viewRegister } from './auth.js';
import { viewAdmin } from './admin.js';

let price = 600;

const rays = document.querySelector('.rays');
for (let i = 0; i < 24; i++) {
  const angle = -Math.PI / 2 + i * Math.PI / 12;
  const ray = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  for (const [name, radius, axis] of [['x1', 10.4, Math.cos], ['y1', 10.4, Math.sin], ['x2', 22.6, Math.cos], ['y2', 22.6, Math.sin]]) {
    ray.setAttribute(name, 26 + radius * axis(angle));
  }
  rays.appendChild(ray);
}

document.querySelector('.skip-link').onclick = (event) => {
  event.preventDefault();
  $app.focus();
};

function renderNav() {
  const route = location.hash.split('?')[0] || '#/';
  const links = me
    ? [['#/', '广场'], ['#/submit', '投稿'], ['#/mine', '我的投稿'], ['#/bought', '我买的'], ['#/me', '我的']]
    : [['#/login', '登录'], ['#/register', '注册']];
  if (me?.role === 'admin') links.splice(0, links.length, ['#/admin', '管理'], ['#/me', '收款码']);
  $nav.innerHTML =
    links.map(([h, t]) => `<a href="${h}" ${route === h ? 'aria-current="page"' : ''} class="${route === h ? 'on' : ''}">${t}</a>`).join('') +
    (me ? `<a href="#" id="logout">退出</a>` : '');
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = async (e) => {
    e.preventDefault();
    await api('/logout', { method: 'POST' }).catch(() => {});
    setMe(null);
    location.hash = '#/login';
  };
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
  $app.setAttribute('aria-busy', 'true');
  try {
    await routes[route]();
  } catch (e) {
    $app.innerHTML = emptyState('页面暂时没打开', esc(e.message));
  } finally {
    $app.setAttribute('aria-busy', 'false');
  }
}

// ---------- 广场 / 下单 ----------

async function viewMarket() {
  const { pieces, price_cents } = await api('/pieces');
  price = price_cents;
  $app.innerHTML = `
    <section class="market-hero">
      <div><span class="eyebrow"><span class="tiny-dot"></span>生活有点苦，来点好笑的。</span><h1><span class="hl-mask"><span class="hl-line">好段子，</span></span><span class="hl-mask"><span class="hl-line">值得独享。</span></span></h1>
      <p>发现有趣的开头，把完整的快乐带走。</p>
      <a class="btn hero-cta" href="#/submit">写个段子 <span aria-hidden="true">↗</span></a></div>
      <div class="hero-note"><span>公开开头</span><i aria-hidden="true">→</i><span>买下段子</span><i aria-hidden="true">→</i><span>独享全文</span></div>
    </section>
    <div class="section-heading"><h2>逛逛段子铺 <span class="count">${pieces.length}</span></h2><span class="meta">统一售价 <span class="price">${yuan(price)}</span> / 条</span></div>
    ${pieces.length ? '' : emptyState('好段子正在路上', '暂时还没有在售内容，也许下一条就来自你。', '#/submit', '写个段子')}
    <div class="piece-grid">
    ${pieces
      .map(
        (p) => `
      <article class="card piece-card">
        <div class="piece-top"><span class="eyebrow">一个有趣的开头</span><span class="piece-quote" aria-hidden="true">“</span></div>
        <h3>${esc(p.title)}</h3>
        <div class="preview">${esc(p.preview)}…</div>
        <div class="piece-footer">
          <span class="author"><span class="avatar" aria-hidden="true">${esc(Array.from(p.author || '匿')[0])}</span>${esc(p.author)}</span>
          ${p.mine ? '<span class="tag">我的投稿</span>' : `<button data-buy="${p.id}" aria-label="${esc(yuan(price) + ' 买下《' + p.title + '》')}">${yuan(price)} 买下 <span aria-hidden="true">↗</span></button>`}
        </div>
      </article>`,
      )
      .join('')}</div>`;
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
    ${heading('我买的段子', '你的独家快乐，都收在这里。', '我的书架')}
    ${
      pending
        ? `<div class="card"><b>待付款</b>：请扫下面的码付款，<b>备注里写订单号</b>。管理员确认收款后就能看到全文。
           ${qr ? `<img class="qr" src="${qr}" alt="收款码">` : '<p class="muted">管理员还没上传收款码，请联系管理员。</p>'}</div>`
        : ''
    }
    ${orders.length ? '' : emptyState('书架还是空的', '去广场挑一个喜欢的开头吧。', '#/', '逛逛广场')}
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
    ${heading('把你的好笑，写下来。', '留一个让人好奇的开头，把包袱藏在全文里。', '创作时间')}
    <form class="card editor-card" id="f">
      <label for="title">标题 <span class="field-hint">最多 60 字</span></label><input id="title" placeholder="给这个段子起个名字" name="title" maxlength="60" required>
      <label for="preview">公开开头 <span class="field-hint">最多 300 字</span></label><p class="field-description">展示在广场，让读者想知道接下来发生了什么。</p><textarea id="preview" placeholder="故事是这样开始的……" name="preview" maxlength="300" required></textarea>
      <label for="content">完整段子 <span class="field-hint">最多 5,000 字</span></label><p class="field-description">买家付款并经管理员确认后可见。</p><textarea id="content" placeholder="在这里写下完整的故事和包袱" name="content" maxlength="5000" class="content-input" required></textarea>
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
    ${heading('我的投稿', '从一个灵感，到一份被买走的快乐。', '我的创作')}
    ${me.has_qr ? '' : '<div class="notice">先备好收款码，卖出后才能收到结算。<a href="#/me">去上传 ↗</a></div>'}
    ${pieces.length ? '' : emptyState('第一个段子，从这里开始', '把生活里有趣的瞬间写下来。', '#/submit', '去投稿')}
    ${pieces
      .map(
        (p) => `
      <div class="card">
        <h3>${esc(p.title)}</h3>
        <div class="row status-row">${status(p)}<span class="meta">${time(p.created_at)}</span></div>
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
    ${heading(isAdmin ? '平台收款码' : '我的账户', isAdmin ? '买家扫码付款，使用这里的收款码。' : '管理你的收款码，让好段子有好回报。', '账户设置')}
    <div class="card">
      <div class="profile"><span class="avatar" aria-hidden="true">${esc(Array.from(me.name)[0])}</span><div><h3>${esc(me.name)}</h3><span class="meta">${esc(me.account)}</span></div></div>
      <p class="meta">${isAdmin ? '买家下单后会看到这张码，用来付款给你。' : '卖出段子后，管理员会扫这张码给你结算。'}</p>
      ${qr ? `<img class="qr" id="qrimg" src="${qr}" alt="收款码">` : '<p class="muted" id="qrimg">还没上传收款码</p>'}
      <label for="qrfile">上传${qr ? '新的' : ''}微信或支付宝收款码</label>
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

window.addEventListener('hashchange', router);
(async () => {
  await loadMe();
  router();
})();
