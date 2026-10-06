-- 段子铺 数据结构
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account     TEXT NOT NULL UNIQUE,          -- 手机号或邮箱（邮箱统一小写）
  name        TEXT NOT NULL,
  pass_hash   TEXT NOT NULL,
  salt        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user',  -- user | admin
  qr          TEXT,                          -- 收款码，压缩后的 data URL
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS pieces (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  preview     TEXT NOT NULL,                 -- 公开的开头
  content     TEXT NOT NULL,                 -- 付款后可见的全文
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at  INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS pieces_status ON pieces(status);
CREATE INDEX IF NOT EXISTS pieces_author ON pieces(author_id);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id     INTEGER NOT NULL REFERENCES pieces(id),
  buyer_id     INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,             -- 买家付给平台
  author_cents INTEGER NOT NULL,             -- 结算给作者
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | paid | cancelled
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER,
  settled_at   INTEGER
);
-- 一条段子同一时间只能有一个有效订单：两人同时下单，只有一个能插入成功
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_active ON orders(piece_id) WHERE status IN ('pending', 'paid');
CREATE INDEX IF NOT EXISTS orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
