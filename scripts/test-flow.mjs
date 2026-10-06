// 端到端流程测试。先在另一个终端运行 `npm run dev`，再运行 `npm test`。
// 用法：BASE=http://127.0.0.1:8787 ADMIN_ACCOUNT=... ADMIN_PASSWORD=... node scripts/test-flow.mjs
// 默认读取 .dev.vars 里的管理员账号。每次运行用新的随机账号，可重复运行。
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const vars = Object.fromEntries(
  (() => {
    try {
      return readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => /^\w+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]);
    } catch {
      return [];
    }
  })(),
);
const ADMIN_ACCOUNT = process.env.ADMIN_ACCOUNT || vars.ADMIN_ACCOUNT;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || vars.ADMIN_PASSWORD;

let passed = 0;
function check(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

class Client {
  constructor() {
    this.cookie = '';
  }
  async req(path, { method = 'GET', data, raw } = {}) {
    const headers = { cookie: this.cookie };
    if (data !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + '/api' + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const body = raw ? Buffer.from(await res.arrayBuffer()).toString('utf8') : await res.json().catch(() => ({}));
    return { status: res.status, body };
  }
}

const tag = Date.now().toString().slice(-8);
const phone = (n) => `13${n}${tag}`.slice(0, 11);

const admin = new Client();
const author = new Client();
const buyerA = new Client();
const buyerB = new Client();
const anon = new Client();

// 注册 / 登录
let r = await author.req('/register', { method: 'POST', data: { account: phone(1), name: '作者小王', password: 'secret123' } });
check(r.status === 201, '手机号注册');
r = await buyerA.req('/register', { method: 'POST', data: { account: `A${tag}@Example.com`, name: '买家A', password: 'secret123' } });
check(r.status === 201, '邮箱注册');
r = await buyerB.req('/register', { method: 'POST', data: { account: phone(2), name: '买家B', password: 'secret123' } });
check(r.status === 201, '第二个买家注册');
r = await anon.req('/register', { method: 'POST', data: { account: `a${tag}@example.com`, name: 'x', password: 'secret123' } });
check(r.status === 409, '邮箱大小写不同也算重复注册');
r = await anon.req('/register', { method: 'POST', data: { account: '12345', name: 'x', password: 'secret123' } });
check(r.status === 400, '非法账号被拒');
r = await anon.req('/register', { method: 'POST', data: { account: ADMIN_ACCOUNT, name: 'x', password: 'secret123' } });
check(r.status === 409, '不能抢注管理员账号');
r = await anon.req('/login', { method: 'POST', data: { account: phone(1), password: 'wrong-pass' } });
check(r.status === 401, '错误密码登录失败');
r = await new Client().req('/login', { method: 'POST', data: { account: phone(1), password: 'secret123' } });
check(r.status === 200, '正确密码登录');
r = await admin.req('/login', { method: 'POST', data: { account: ADMIN_ACCOUNT, password: 'nope' } });
check(r.status === 401, '管理员错误密码被拒');
r = await admin.req('/login', { method: 'POST', data: { account: ADMIN_ACCOUNT, password: ADMIN_PASSWORD } });
check(r.status === 200, '管理员登录');
r = await admin.req('/me');
check(r.body.user?.role === 'admin', '管理员身份正确');

// 权限
r = await anon.req('/pieces');
check(r.status === 401, '未登录不能看广场');
r = await author.req('/admin/stats');
check(r.status === 403, '普通用户不能进管理接口');
r = await author.req('/admin/export.csv', { raw: true });
check(r.status === 403, '普通用户不能导出 CSV');
r = await author.req('/pieces', { method: 'POST', data: 'x' });
check(r.status === 400 || r.status === 415, '格式不对的请求被拒');
const formPost = await fetch(BASE + '/api/pieces', {
  method: 'POST',
  headers: { cookie: author.cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: 'title=a&preview=b&content=c',
});
check(formPost.status === 415, '表单提交（跨站伪造）被拒');

// 收款码上传
const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
r = await author.req('/me/qr', { method: 'POST', data: { image: tinyPng } });
check(r.status === 200, '作者上传收款码');
r = await admin.req('/me/qr', { method: 'POST', data: { image: tinyPng } });
check(r.status === 200, '管理员上传平台收款码');
r = await author.req('/me/qr', { method: 'POST', data: { image: 'data:image/png;base64,' + 'A'.repeat(500_000) } });
check(r.status === 413, '超大图片被拒');
r = await author.req('/me/qr', { method: 'POST', data: { image: 'javascript:alert(1)' } });
check(r.status === 400, '非图片被拒');

// 投稿 / 审核
r = await author.req('/pieces', { method: 'POST', data: { title: '程序员的周一', preview: '早上九点', content: '早上九点，我打开电脑，电脑打开了我。' } });
check(r.status === 201, '投稿');
const pieceId = r.body.id;
r = await author.req('/pieces', { method: 'POST', data: { title: '会被拒的', preview: '开头', content: '全文' } });
const rejectId = r.body.id;
r = await buyerA.req('/pieces');
check(!r.body.pieces.some((p) => p.id === pieceId), '未审核的不出现在广场');
r = await buyerA.req(`/pieces/${pieceId}`);
check(r.status === 404, '未审核的买家看不到');
r = await admin.req('/admin/pieces?status=pending');
check(r.body.pieces.some((p) => p.id === pieceId), '管理员看到待审核');
r = await admin.req(`/admin/pieces/${pieceId}/review`, { method: 'POST', data: { action: 'approve' } });
check(r.status === 200, '审核通过');
r = await admin.req(`/admin/pieces/${rejectId}/review`, { method: 'POST', data: { action: 'reject' } });
check(r.status === 200, '审核拒绝');
r = await admin.req(`/admin/pieces/${pieceId}/review`, { method: 'POST', data: { action: 'reject' } });
check(r.status === 404, '不能重复审核');
r = await buyerA.req('/pieces');
check(r.body.pieces.some((p) => p.id === pieceId) && !r.body.pieces.some((p) => p.id === rejectId), '通过的上架，拒绝的不上架');
check(r.body.pieces.every((p) => !('content' in p)), '广场不返回全文');
r = await buyerA.req(`/pieces/${pieceId}`);
check(r.body.piece.content === null, '没付款看不到全文');
r = await author.req(`/pieces/${pieceId}/order`, { method: 'POST' });
check(r.status === 400, '不能买自己的段子');

// 并发下单：两人同时下同一条，只有一个成功
const [oa, ob] = await Promise.all([
  buyerA.req(`/pieces/${pieceId}/order`, { method: 'POST' }),
  buyerB.req(`/pieces/${pieceId}/order`, { method: 'POST' }),
]);
const statuses = [oa.status, ob.status].sort();
check(statuses[0] === 201 && statuses[1] === 409, `两人同时下单只有一个成功（${oa.status}/${ob.status}）`);
const [winner, loser] = oa.status === 201 ? [buyerA, buyerB] : [buyerB, buyerA];
const orderId = (oa.status === 201 ? oa : ob).body.order.id;
check((oa.status === 201 ? oa : ob).body.order.amount_cents === 600, '订单金额 ¥6');

// 更大并发：10 个人抢一条
r = await author.req('/pieces', { method: 'POST', data: { title: '抢购测试', preview: '开头', content: '全文' } });
const rushId = r.body.id;
await admin.req(`/admin/pieces/${rushId}/review`, { method: 'POST', data: { action: 'approve' } });
const rushers = [];
for (let i = 0; i < 10; i++) {
  const c = new Client();
  await c.req('/register', { method: 'POST', data: { account: `rush${i}.${tag}@example.com`, name: `抢${i}`, password: 'secret123' } });
  rushers.push(c);
}
const rush = await Promise.all(rushers.map((c) => c.req(`/pieces/${rushId}/order`, { method: 'POST' })));
check(rush.filter((x) => x.status === 201).length === 1 && rush.filter((x) => x.status === 409).length === 9, '10 人同时抢一条，只有 1 人订到');

r = await loser.req('/pieces');
check(!r.body.pieces.some((p) => p.id === pieceId), '被订走的从广场下架');
r = await winner.req('/pay-qr');
check(r.body.qr === tinyPng, '买家看到平台收款码');
r = await winner.req(`/pieces/${pieceId}`);
check(r.body.piece.content === null, '未确认收款前看不到全文');
r = await loser.req(`/orders/${orderId}/cancel`, { method: 'POST' });
check(r.status === 404, '不能取消别人的订单');
r = await winner.req(`/admin/orders/${orderId}/confirm`, { method: 'POST' });
check(r.status === 403, '买家不能自己确认收款');

// 确认收款
r = await admin.req('/admin/orders?status=pending');
check(r.body.orders.some((o) => o.id === orderId), '管理员看到待收款订单');
r = await admin.req(`/admin/orders/${orderId}/confirm`, { method: 'POST' });
check(r.status === 200, '确认收款');
r = await admin.req(`/admin/orders/${orderId}/confirm`, { method: 'POST' });
check(r.status === 404, '不能重复确认');
r = await winner.req(`/pieces/${pieceId}`);
check(r.body.piece.content?.includes('电脑打开了我'), '确认收款后买家看到全文');
r = await winner.req('/orders/mine');
check(r.body.orders.find((o) => o.id === orderId)?.content?.includes('电脑打开了我'), '我买的里有全文');
r = await loser.req(`/pieces/${pieceId}`);
check(r.body.piece.content === null, '没买的人仍然看不到全文');
r = await winner.req(`/orders/${orderId}/cancel`, { method: 'POST' });
check(r.status === 404, '已付款订单不能取消');

// 取消订单后重新上架
const rushOrder = rush.find((x) => x.status === 201).body.order.id;
r = await admin.req(`/admin/orders/${rushOrder}/cancel`, { method: 'POST' });
check(r.status === 200, '管理员取消未付款订单');
r = await buyerA.req('/pieces');
check(r.body.pieces.some((p) => p.id === rushId), '取消后重新上架');

// 作者视角
r = await author.req('/pieces/mine');
const mine = r.body.pieces.find((p) => p.id === pieceId);
check(mine.order_status === 'paid' && !mine.settled_at && mine.author_cents === 600, '作者看到已卖出待结算 ¥6');

// 结算
r = await admin.req('/admin/settlements');
const entry = r.body.authors.find((a) => a.order_ids.includes(orderId));
check(entry && entry.qr === tinyPng && entry.total_cents >= 600, '结算页显示作者收款码和金额');
r = await author.req(`/admin/settlements/${entry.author_id}`, { method: 'POST', data: { order_ids: entry.order_ids } });
check(r.status === 403, '普通用户不能结算');
r = await admin.req(`/admin/settlements/${entry.author_id}`, { method: 'POST', data: { order_ids: entry.order_ids } });
check(r.body.settled === entry.order_ids.length, '标记结算');
r = await admin.req(`/admin/settlements/${entry.author_id}`, { method: 'POST', data: { order_ids: entry.order_ids } });
check(r.body.settled === 0, '不会重复结算');
r = await author.req('/pieces/mine');
check(r.body.pieces.find((p) => p.id === pieceId).settled_at, '作者看到已结算');

// 统计 / 导出
r = await admin.req('/admin/stats');
check(r.body.stats.paid_orders >= 1 && r.body.stats.income_cents >= 600, '统计数字');
r = await admin.req('/admin/export.csv', { raw: true });
check(r.status === 200 && r.body.startsWith('﻿订单号') && r.body.includes('程序员的周一') && r.body.includes('已付款'), '导出 CSV');

// 退出
r = await winner.req('/logout', { method: 'POST' });
r = await winner.req('/me');
check(r.status === 401, '退出后登录态失效');

console.log(`\n全部通过：${passed} 项`);
