# 段子铺 · Cloudflare 版

网页、后端和数据库都跑在 Cloudflare 上，不用买服务器。二三十人用，在免费额度内。

- 手机号或邮箱注册，每条 ¥6（可在 `wrangler.jsonc` 里改）
- 作者投稿 → 管理员审核上架 → 买家下单并扫平台收款码付款 → 管理员确认收款 → 买家看到全文
- 每条只卖一次：两个人同时下单同一条，只有一个能订到（数据库唯一索引保证）
- 管理员在“结算”页扫作者的收款码付款，再点“已结算”
- 管理员可导出全部订单 CSV（Excel 直接打开不乱码）
- 收款码在浏览器里先压缩（最长边 800px 的 JPEG，通常 100～200KB）再上传，放得进 D1 的单行

## 目录

```
src/index.js              后端（Cloudflare Worker，处理 /api/*）
public/                   网页（静态资源）
migrations/0001_init.sql  数据库建表
scripts/test-flow.mjs     端到端测试（注册、审核、下单、并发、收款、结算、导出、权限）
wrangler.jsonc            Cloudflare 配置
```

## 前端界面

前端使用原生 ES modules，不需要构建步骤，也没有新增运行时依赖。

- `public/app.js`：导航、路由、广场、投稿、订单及账户页面
- `public/auth.js`：登录与注册；`public/admin.js`：管理工作台
- `public/core.js`：共享登录状态、API 请求、图片压缩及表单处理
- `public/style.css` / `public/auth.css`：公共样式与账户入口样式，断点为 600px、900px
- `public/shop.svg` / `public/favicon.svg`：本地矢量插画与图标，不依赖外部图片或字体服务

`temp/` 只保存本地预览和临时检查，不纳入版本控制。界面改版不需要数据库迁移。

## 部署前确认

你个人网站的域名，**DNS 要托管在 Cloudflare 上**。如果现在在别家（阿里云、腾讯云、GoDaddy 等），先在 Cloudflare 后台 “Add a site” 把域名加进去，再去原注册商把 NS 改成 Cloudflare 给的两个地址，等它显示 Active。

电脑上需要装 Node.js 18 或更新版本。

## 部署（约 10 分钟，在你自己电脑的终端里做）

### 1. 安装并登录

```bash
cd duanzipu-cf
npm install
npx wrangler login        # 会弹出浏览器让你授权 Cloudflare 账号
```

### 2. 建数据库，填配置

```bash
npx wrangler d1 create duanzipu
```

输出里有一行 `"database_id": "xxxxxxxx-...."`。打开 `wrangler.jsonc`：

- 把 `REPLACE_WITH_YOUR_D1_DATABASE_ID` 换成这个 id
- 把 `duanzi.example.com` 换成你想用的子域名，比如 `duanzi.yourname.com`
- 想改价格或作者分成，改 `PRICE_CENTS`（单位分）和 `AUTHOR_SHARE_PERCENT`

### 3. 建表，设置管理员账号和密码

```bash
npm run db:init                          # 在线上数据库建表
npx wrangler secret put ADMIN_ACCOUNT    # 输入管理员的手机号或邮箱
npx wrangler secret put ADMIN_PASSWORD   # 输入管理员密码（建议 12 位以上）
```

管理员账号不用注册，第一次用上面的账号密码登录时自动创建。以后想改密码，重新 `secret put ADMIN_PASSWORD` 就行。

> 第一次 `secret put` 时如果提示 Worker 还不存在，选 yes 让它创建即可。

### 4. 上线

```bash
npx wrangler deploy
```

完成后打开 `https://duanzi.yourname.com`（第一次可能要等一两分钟证书生效）。

### 5. 上线后先做两件事

1. 用管理员账号登录，点“收款码”，上传你自己的微信或支付宝收款码。买家下单后看到的就是这张。
2. 自己注册一个普通账号走一遍：投稿 → 管理员审核 → 另一个账号下单 → 确认收款 → 结算。

## 日常使用

- **审核**：管理 → 审核，看全文后点“通过”或“不通过”
- **收款**：买家付款时备注订单号。在收款记录里核对订单号和金额后，管理 → 待收款 → “确认收款”。买家没付款的单可以“取消订单”，段子会重新上架
- **结算**：管理 → 结算，按作者汇总了应结金额，扫作者收款码付完点“已结算”
- **导出**：管理页的“导出 CSV”

## 本地开发和测试

```bash
cp .dev.vars.example .dev.vars   # 本地管理员账号密码
npm run dev                      # 建本地表并启动，打开 http://localhost:8787
npm test                         # 另开一个终端运行，测试整套流程
```

## 更新

改完代码后再 `npx wrangler deploy` 即可。以后如果加了新的 `migrations/000x_*.sql`，先跑 `npm run db:init`。

## 大陆访问

Cloudflare 在大陆没有节点，速度因运营商和时段而异。正式拉人之前，找两三个在大陆、用不同运营商（电信、联通、移动）的朋友，分别在白天和晚上 8 到 11 点打开试试。卡的话再考虑换香港服务器部署。

## 备份

```bash
npx wrangler d1 export duanzipu --remote --output backup.sql
```
