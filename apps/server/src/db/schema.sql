-- retouch-studio 业务表（SQLite 方言；生产换 Postgres 时 TEXT 存 JSON 的列改 JSONB）
-- PRAGMA 在 src/db/index.ts 里设置，不放在这里，避免 exec 的返回值干扰

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  quota_per_day INTEGER NOT NULL DEFAULT 30,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  created_by TEXT,
  used_by    TEXT,
  used_at    TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  kind           TEXT NOT NULL,
  path           TEXT NOT NULL,
  parent_task_id TEXT,
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  bytes          INTEGER NOT NULL,
  mime           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_user ON images (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  title           TEXT NOT NULL,
  canvas          TEXT NOT NULL,
  source_image_id TEXT,
  thumb_image_id  TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_user ON documents (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  document_id     TEXT,
  plan_id         TEXT,
  step_idx        INTEGER,
  tool            TEXT NOT NULL,
  status          TEXT NOT NULL,
  progress        REAL NOT NULL DEFAULT 0,
  provider        TEXT,
  model           TEXT,
  input           TEXT NOT NULL,
  mask_image_id   TEXT,
  image_id        TEXT,
  result_image_id TEXT,
  output          TEXT,
  cost_yuan       REAL NOT NULL DEFAULT 0,
  error           TEXT,
  error_code      TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  charged         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status, created_at);

CREATE TABLE IF NOT EXISTS plans (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  document_id  TEXT NOT NULL,
  user_message TEXT NOT NULL,
  planner      TEXT NOT NULL,
  status       TEXT NOT NULL,
  summary      TEXT,
  steps        TEXT NOT NULL,
  cost_yuan    REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_user ON plans (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id    TEXT NOT NULL,
  date       TEXT NOT NULL,
  ai_calls   INTEGER NOT NULL DEFAULT 0,
  cost_yuan  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
