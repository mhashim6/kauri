-- Kauri schema v2 — record links.
--
-- Adds a junction table for general-purpose "related to" / "see also"
-- links between records. Links are stored directionally but read
-- bidirectionally (if A links to B, showing B also shows A).
--
-- No link type column in v0.1 — all links are "related". A type
-- discriminator can be added in a future migration if needed.

CREATE TABLE record_links (
  from_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  to_record_id   TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  PRIMARY KEY (from_record_id, to_record_id)
);

CREATE INDEX idx_record_links_to ON record_links(to_record_id);
