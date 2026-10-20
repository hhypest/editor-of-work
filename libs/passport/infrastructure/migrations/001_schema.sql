-- Схема паспорта: docs/architecture.md, 8.1. Только добавлять новые миграции.
CREATE TABLE edition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE CHECK (number > 0),
  date TEXT NOT NULL CHECK (length(date) = 10),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived'))
) STRICT;
CREATE UNIQUE INDEX one_active_edition ON edition(status) WHERE status = 'active';

CREATE TABLE import_file (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  form TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  warnings TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings)),
  PRIMARY KEY (edition_id, id)
) STRICT;

CREATE TABLE excluded_object (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE line (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE line_extent (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  start_km INTEGER NOT NULL CHECK (start_km >= 0),
  start_m INTEGER NOT NULL CHECK (start_m >= 0),
  end_km INTEGER NOT NULL CHECK (end_km >= 0),
  end_m INTEGER NOT NULL CHECK (end_m >= 0),
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE line_km (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  km INTEGER NOT NULL CHECK (km >= 0),
  length_m INTEGER NOT NULL CHECK (length_m > 0),
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (edition_id, line_id, km),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE territory (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  okato TEXT NOT NULL,
  type TEXT NOT NULL,
  parent_id TEXT,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, parent_id) REFERENCES territory(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE subdivision (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL,
  parent_id TEXT,
  activity TEXT,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, parent_id) REFERENCES subdivision(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE subdivision_segment (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  start_km INTEGER NOT NULL CHECK (start_km >= 0),
  start_m INTEGER NOT NULL CHECK (start_m >= 0),
  end_km INTEGER NOT NULL CHECK (end_km >= 0),
  end_m INTEGER NOT NULL CHECK (end_m >= 0),
  subdivision_id TEXT NOT NULL,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  FOREIGN KEY (edition_id, subdivision_id) REFERENCES subdivision(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE station (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE station_axis (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  axis_km INTEGER NOT NULL CHECK (axis_km >= 0),
  axis_m INTEGER NOT NULL CHECK (axis_m >= 0),
  start_km INTEGER NOT NULL CHECK (start_km >= 0),
  start_m INTEGER NOT NULL CHECK (start_m >= 0),
  end_km INTEGER NOT NULL CHECK (end_km >= 0),
  end_m INTEGER NOT NULL CHECK (end_m >= 0),
  first_switch TEXT,
  last_switch TEXT,
  track_section TEXT,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (edition_id, station_id) REFERENCES station(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE station_pd (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  subdivision_id TEXT NOT NULL,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, station_id) REFERENCES station(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (edition_id, subdivision_id) REFERENCES subdivision(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE station_track (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  number TEXT NOT NULL,
  purpose TEXT,
  full_length_m REAL CHECK (full_length_m >= 0),
  usable_length_m REAL CHECK (usable_length_m >= 0),
  capacity REAL CHECK (capacity >= 0),
  rail_type TEXT,
  sleeper_type TEXT,
  ballast_type TEXT,
  last_repair_year INTEGER,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, station_id) REFERENCES station(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (edition_id, station_id, number),
  UNIQUE (edition_id, station_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE station_track_pd (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  subdivision_id TEXT NOT NULL,
  whole_track INTEGER NOT NULL CHECK (whole_track IN (0, 1)),
  start_m INTEGER CHECK (start_m >= 0),
  end_m INTEGER CHECK (end_m >= start_m),
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, station_id) REFERENCES station(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((whole_track = 1 AND start_m IS NULL AND end_m IS NULL) OR (whole_track = 0 AND start_m IS NOT NULL AND end_m IS NOT NULL)),
  FOREIGN KEY (edition_id, station_id, track_id) REFERENCES station_track(edition_id, station_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (edition_id, subdivision_id) REFERENCES subdivision(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE station_switch (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  number TEXT NOT NULL,
  track_id TEXT,
  type TEXT,
  rail_type TEXT,
  frog TEXT,
  drive TEXT,
  sleeper_type TEXT,
  laid_year INTEGER,
  last_repair_year INTEGER,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, station_id) REFERENCES station(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (edition_id, station_id, number),
  FOREIGN KEY (edition_id, station_id, track_id) REFERENCES station_track(edition_id, station_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE station_layout (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  layout TEXT NOT NULL CHECK (json_valid(layout)),
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, station_id) REFERENCES station(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (edition_id, station_id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE station_object (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL CHECK (width >= 0),
  height REAL CHECK (height >= 0),
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, station_id) REFERENCES station(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE crossing (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  station_id TEXT,
  territory_id TEXT,
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  km INTEGER NOT NULL CHECK (km >= 0),
  m INTEGER NOT NULL CHECK (m >= 0),
  category TEXT,
  type TEXT,
  road TEXT,
  regulated INTEGER CHECK (regulated IN (0, 1)),
  signalling TEXT,
  surface TEXT,
  barriers TEXT,
  signs TEXT,
  trains_per_day REAL CHECK (trains_per_day >= 0),
  vehicles_per_day REAL CHECK (vehicles_per_day >= 0),
  train_speed REAL CHECK (train_speed >= 0),
  road_speed REAL CHECK (road_speed >= 0),
  visibility_m REAL CHECK (visibility_m >= 0),
  last_overhaul_date TEXT,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (edition_id, station_id) REFERENCES station(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (edition_id, territory_id) REFERENCES territory(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE work_kind (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  group_name TEXT NOT NULL,
  included_in_id TEXT,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  UNIQUE (edition_id, code),
  FOREIGN KEY (edition_id, included_in_id) REFERENCES work_kind(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE repair_norm (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  work_kind_id TEXT NOT NULL,
  track_class TEXT,
  track_group TEXT,
  track_category TEXT,
  rail_type TEXT,
  sleeper_type TEXT,
  years REAL CHECK (years > 0),
  million_tons REAL CHECK (million_tons > 0),
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  CHECK (years IS NOT NULL OR million_tons IS NOT NULL),
  FOREIGN KEY (edition_id, work_kind_id) REFERENCES work_kind(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE tolerance (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  conditions TEXT,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE seg_class (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  start_km INTEGER NOT NULL CHECK (start_km >= 0),
  start_m INTEGER NOT NULL CHECK (start_m >= 0),
  end_km INTEGER NOT NULL CHECK (end_km >= 0),
  end_m INTEGER NOT NULL CHECK (end_m >= 0),
  class TEXT,
  group_name TEXT,
  category TEXT,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE seg_load (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  start_km INTEGER NOT NULL CHECK (start_km >= 0),
  start_m INTEGER NOT NULL CHECK (start_m >= 0),
  end_km INTEGER NOT NULL CHECK (end_km >= 0),
  end_m INTEGER NOT NULL CHECK (end_m >= 0),
  gross_million_ton_km REAL CHECK (gross_million_ton_km >= 0),
  axle_load REAL CHECK (axle_load >= 0),
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE seg_speed (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  start_km INTEGER NOT NULL CHECK (start_km >= 0),
  start_m INTEGER NOT NULL CHECK (start_m >= 0),
  end_km INTEGER NOT NULL CHECK (end_km >= 0),
  end_m INTEGER NOT NULL CHECK (end_m >= 0),
  passenger REAL,
  freight REAL,
  suburban REAL,
  empty REAL,
  express REAL,
  high_speed REAL,
  restriction_reason TEXT,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE seg_rail (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  start_km INTEGER NOT NULL CHECK (start_km >= 0),
  start_m INTEGER NOT NULL CHECK (start_m >= 0),
  end_km INTEGER NOT NULL CHECK (end_km >= 0),
  end_m INTEGER NOT NULL CHECK (end_m >= 0),
  type TEXT,
  laying_sign TEXT,
  laid_date TEXT,
  link_length_m REAL,
  continuous_welded INTEGER CHECK (continuous_welded IN (0, 1)),
  hardening TEXT,
  plant TEXT,
  class TEXT,
  group_name TEXT,
  wear_mm REAL,
  tonnage_before REAL,
  tonnage_after REAL,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE seg_sleeper (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  start_km INTEGER NOT NULL CHECK (start_km >= 0),
  start_m INTEGER NOT NULL CHECK (start_m >= 0),
  end_km INTEGER NOT NULL CHECK (end_km >= 0),
  end_m INTEGER NOT NULL CHECK (end_m >= 0),
  base_type TEXT,
  density REAL,
  fastening_type TEXT,
  fastening_defective REAL,
  shock_absorbers TEXT,
  tonnage REAL,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE seg_ballast (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  start_km INTEGER NOT NULL CHECK (start_km >= 0),
  start_m INTEGER NOT NULL CHECK (start_m >= 0),
  end_km INTEGER NOT NULL CHECK (end_km >= 0),
  end_m INTEGER NOT NULL CHECK (end_m >= 0),
  type TEXT,
  thickness_cm REAL,
  contamination REAL,
  separating_layer TEXT,
  protective_layer TEXT,
  prism_shortage_cm REAL,
  shoulder_shortage_cm REAL,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE seg_train_pairs (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  start_km INTEGER NOT NULL CHECK (start_km >= 0),
  start_m INTEGER NOT NULL CHECK (start_m >= 0),
  end_km INTEGER NOT NULL CHECK (end_km >= 0),
  end_m INTEGER NOT NULL CHECK (end_m >= 0),
  freight REAL CHECK (freight >= 0),
  passenger REAL CHECK (passenger >= 0),
  suburban REAL CHECK (suburban >= 0),
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

