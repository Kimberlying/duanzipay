import { $app, esc, yuan, time, toast, api, heading, emptyState } from './core.js';

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
    ${heading('店铺管理', '审核投稿、确认收款，照顾好每一笔好生意。', '店长工作台')}
    <div class="stats">
      <div class="stat"><b>${stats.users}</b><span>用户</span></div>
      <div class="stat"><b>${stats.paid_orders}</b><span>已卖出</span></div>
      <div class="stat"><b>${yuan(stats.income_cents)}</b><span>总收款</span></div>
      <div class="stat"><b>${stats.pending_orders}</b><span>待收款</span></div>
      <div class="stat"><b>${stats.pending_pieces}</b><span>待审核</span></div>
      <div class="stat"><b>${yuan(stats.unsettled_cents)}</b><span>待结算</span></div>
    </div>
    <div class="tabs" aria-label="管理分类">${tabs.map(([k, t]) => `<button data-tab="${k}" aria-pressed="${adminTab === k}" class="${adminTab === k ? 'on' : ''}">${t}</button>`).join('')}
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
    : emptyState('投稿都处理好了', '新的投稿会出现在这里。');
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
    : emptyState('暂时没有待收款订单', '买家下单后，在这里核对付款。');
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
    : emptyState('还没有已付款订单', '确认收款后的订单会保存在这里。');
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
    : emptyState('结算都处理好了', '有新的应结款项时，会在这里按作者汇总。');
  panel.querySelectorAll('[data-settle]').forEach(
    (b) =>
      (b.onclick = () =>
        confirm('确认已经付给作者了？') &&
        act(`/admin/settlements/${b.dataset.settle}`, { order_ids: b.dataset.ids.split(',').map(Number) }, '已标记结算')),
  );
}


export { viewAdmin };
