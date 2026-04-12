-- Kauri schema v1 — initial migration.
--
-- This file is the source of truth for the v0.1 schema. The migration
-- runner (src/store/migrations.ts) executes it inside a single
-- BEGIN IMMEDIATE transaction at `kauri init` time. The compile-time
-- codegen at scripts/embed-migrations.ts embeds the file as a text
-- import so `bun build --compile` bundles it into the binary.
--
-- See kauri-spec.md § Storage › Tables for the authoritative schema
-- description. Comments here document SQLite-specific concerns only.
--
-- The migration runner sets PRAGMA user_version and writes
-- meta.schema_version separately, so we don't touch them here.
-- The init service (Phase C) seeds the project slug, created_at, and
-- the default taxonomy at runtime — those values depend on init time.

-- ---------------------------------------------------------------------------
-- records
-- ---------------------------------------------------------------------------
--
-- Every Kauri record (decision, and any future kind) lives in this single
-- table. The `kind` discriminator is the forward-compatibility hook for
-- v0.2+. The `payload` JSON column is reserved (always NULL in v0.1).
--
-- Note on `scope`: each store file holds records of a single scope, so
-- the column is technically redundant within one DB. We keep it so that
-- merged-read output from `multi-store.ts` can carry self-describing rows
-- without losing provenance.
--
-- Foreign keys on `supersedes` and `superseded_by` are only enforced when
-- `PRAGMA foreign_keys = ON`, which the Store class sets on every open.

CREATE TABLE records (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  scope           TEXT NOT NULL CHECK (scope IN ('project', 'user')),
  status          TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded', 'deprecated')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  source          TEXT NOT NULL,
  supersedes      TEXT REFERENCES records(id),
  superseded_by   TEXT REFERENCES records(id),
  ttl_days        INTEGER,
  pinned          INTEGER NOT NULL DEFAULT 0,
  payload         TEXT,
  revision        INTEGER NOT NULL DEFAULT 1,
  created         TEXT NOT NULL,
  last_modified   TEXT NOT NULL,
  last_validated  TEXT NOT NULL
);

CREATE INDEX idx_records_status ON records(status);
CREATE INDEX idx_records_kind ON records(kind);
-- Partial index over the (small) set of pinned records — used by the
-- projection service which needs `WHERE pinned = 1` on every call.
CREATE INDEX idx_records_pinned ON records(pinned) WHERE pinned = 1;

-- ---------------------------------------------------------------------------
-- record_tags  (junction table — many tags per record)
-- ---------------------------------------------------------------------------
--
-- ON DELETE CASCADE on the record FK is defensive. v0.1 never deletes
-- records (status moves to `deprecated` instead), but test cleanup and
-- future tooling may rely on it.

CREATE TABLE record_tags (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL REFERENCES taxonomy(tag),
  PRIMARY KEY (record_id, tag)
);

CREATE INDEX idx_record_tags_tag ON record_tags(tag);

-- ---------------------------------------------------------------------------
-- record_files  (junction table — files associated with a record)
-- ---------------------------------------------------------------------------
--
-- This is also where staleness baseline state lives. `mtime` and `size`
-- are the fast-path probe; `sha256` is the confirmation hash. `sha256`
-- is NULL when the file exceeded the configured size cap and we chose
-- to track it for navigation only — see kauri-spec.md § Staleness.

CREATE TABLE record_files (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  path      TEXT NOT NULL,
  mtime     INTEGER NOT NULL,
  size      INTEGER NOT NULL,
  sha256    TEXT,
  PRIMARY KEY (record_id, path)
);

CREATE INDEX idx_record_files_path ON record_files(path);

-- ---------------------------------------------------------------------------
-- taxonomy  (the controlled tag vocabulary)
-- ---------------------------------------------------------------------------
--
-- v0.1 supports adding but not removing tags. The `added` column carries
-- the ISO 8601 timestamp of when the tag was first seen.
--
-- Default tags are NOT inserted here — the init service does it at
-- runtime so the `added` timestamp matches the actual init moment
-- rather than the migration's authoring date.

CREATE TABLE taxonomy (
  tag   TEXT PRIMARY KEY,
  added TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- meta  (configuration + version state)
-- ---------------------------------------------------------------------------
--
-- A simple key/value table. Keys we use:
--   schema_version            written by the migration runner
--   slug                      written by the init service
--   created_at                written by the init service
--   default_ttl_days          seeded below; user-configurable
--   pin_soft_cap              seeded below; user-configurable
--   file_hash_size_cap_bytes  seeded below; user-configurable
--
-- Empty string is treated by the typed accessors as "null / disabled"
-- where applicable (e.g. setting default_ttl_days to '' disables
-- time-based staleness entirely). Numeric values are stored as their
-- decimal string form for portability.

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed the configurable defaults that don't depend on init-time state.
-- Keep these in sync with META_DEFAULTS in src/core/constants.ts.
INSERT INTO meta(key, value) VALUES
  ('default_ttl_days',         '90'),
  ('pin_soft_cap',             '10'),
  ('file_hash_size_cap_bytes', '1048576');

-- ---------------------------------------------------------------------------
-- records_fts  (FTS5 full-text index over title + body)
-- ---------------------------------------------------------------------------
--
-- External-content table: FTS5 references the `records` table directly,
-- which means the triggers below are responsible for keeping the index
-- in sync on every INSERT, UPDATE, and DELETE. The 'delete' command
-- pattern is the SQLite-documented way to remove a row from an
-- external-content FTS5 index.
--
-- Tokenizer: `porter unicode61` gives us NFD normalisation, case
-- folding, and English stemming. Good enough for v0.1; we can swap to
-- a fancier tokenizer later without changing the contract.

CREATE VIRTUAL TABLE records_fts USING fts5(
  title,
  body,
  content='records',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER records_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER records_ad AFTER DELETE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER records_au AFTER UPDATE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
  INSERT INTO records_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
