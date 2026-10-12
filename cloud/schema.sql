-- NiuBision D1 schema (migration from KV "niubision-studio").
-- studios: one row per studio (today: NIUBI). state_json is the full app state (source of truth, same shape as KV).
CREATE TABLE IF NOT EXISTS studios (
  key TEXT PRIMARY KEY,
  token TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  sessions_json TEXT NOT NULL DEFAULT '{}',
  fails_json TEXT NOT NULL DEFAULT '{}',
  push_json TEXT NOT NULL DEFAULT '{}',
  extra_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT 0
);
-- entities: queryable projection of every list in state (clients, payments, contracts, receipts,
-- programRequests, revoked, inbox, appointments, history, checkins, weighins, measures, videos ...).
-- Rebuilt from state_json on every write; never the source of truth.
CREATE TABLE IF NOT EXISTS entities (
  studio_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  client_id TEXT,
  at INTEGER,
  status TEXT,
  amount REAL,
  json TEXT NOT NULL,
  PRIMARY KEY (studio_key, kind, id)
);
CREATE INDEX IF NOT EXISTS entities_kind_at ON entities (studio_key, kind, at);
CREATE INDEX IF NOT EXISTS entities_client ON entities (studio_key, client_id);
-- client error reports (replaces KV log:* keys)
CREATE TABLE IF NOT EXISTS logs (
  h TEXT NOT NULL,
  day TEXT NOT NULL,
  t INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 1,
  src TEXT, kind TEXT, msg TEXT, stack TEXT, path TEXT, line INTEGER, col INTEGER, v TEXT, ua TEXT, country TEXT,
  PRIMARY KEY (h, day)
);
CREATE INDEX IF NOT EXISTS logs_t ON logs (t);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
