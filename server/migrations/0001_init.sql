-- Scheura sync + push schema (Cloudflare D1 / SQLite).

-- One row per sync space (space = hex SHA-256 derived from the sync code). seq = last assigned sequence.
CREATE TABLE IF NOT EXISTS spaces (
  space      TEXT PRIMARY KEY,
  seq        INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

-- Encrypted records. data = client-side ciphertext (NULL for tombstones). seq = position in the space's change log.
CREATE TABLE IF NOT EXISTS records (
  space      TEXT    NOT NULL,
  tbl        TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (space, tbl, id)
);
CREATE INDEX IF NOT EXISTS records_space_seq ON records (space, seq);

-- Web Push subscription per device.
CREATE TABLE IF NOT EXISTS push_subs (
  device_id  TEXT PRIMARY KEY,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Scheduled notifications, sent by the cron trigger.
CREATE TABLE IF NOT EXISTS push_queue (
  device_id TEXT    NOT NULL,
  key       TEXT    NOT NULL,
  at        INTEGER NOT NULL,
  title     TEXT    NOT NULL,
  body      TEXT    NOT NULL,
  url       TEXT    NOT NULL,
  sent      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, key)
);
CREATE INDEX IF NOT EXISTS push_queue_sent_at ON push_queue (sent, at);
