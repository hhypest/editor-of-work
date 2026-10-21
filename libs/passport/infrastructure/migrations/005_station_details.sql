-- Станционные данные без вымышленных границ и единственного направления переезда.

CREATE TABLE station_axis_next (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  axis_km INTEGER NOT NULL CHECK (axis_km >= 0),
  axis_m INTEGER NOT NULL CHECK (axis_m >= 0),
  start_km INTEGER CHECK (start_km >= 0),
  start_m INTEGER CHECK (start_m >= 0),
  end_km INTEGER CHECK (end_km >= 0),
  end_m INTEGER CHECK (end_m >= 0),
  first_switch TEXT,
  last_switch TEXT,
  track_section TEXT,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  details TEXT CHECK (details IS NULL OR json_valid(details)),
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (edition_id, station_id) REFERENCES station(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((start_km IS NULL) = (start_m IS NULL)),
  CHECK ((end_km IS NULL) = (end_m IS NULL)),
  CHECK (end_km > start_km OR (end_km = start_km AND end_m >= start_m)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

INSERT INTO station_axis_next (edition_id, id, line_id, station_id, axis_km, axis_m, start_km, start_m, end_km, end_m, first_switch, last_switch, track_section, import_file_id, valid_from, valid_to) SELECT edition_id, id, line_id, station_id, axis_km, axis_m, start_km, start_m, end_km, end_m, first_switch, last_switch, track_section, import_file_id, valid_from, valid_to FROM station_axis;

DROP TABLE station_axis;

ALTER TABLE station_axis_next RENAME TO station_axis;

CREATE TRIGGER station_axis_insert_guard BEFORE INSERT ON station_axis
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER station_axis_update_guard BEFORE UPDATE ON station_axis
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER station_axis_delete_guard BEFORE DELETE ON station_axis
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TABLE crossing_next (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  line_id TEXT,
  station_id TEXT,
  territory_id TEXT,
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  km INTEGER CHECK (km >= 0),
  m INTEGER CHECK (m >= 0),
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
  details TEXT CHECK (details IS NULL OR json_valid(details)),
  PRIMARY KEY (edition_id, id),
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (edition_id, station_id) REFERENCES station(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (edition_id, territory_id) REFERENCES territory(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((km IS NULL) = (m IS NULL)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

INSERT INTO crossing_next (edition_id, id, line_id, station_id, territory_id, number, name, km, m, category, type, road, regulated, signalling, surface, barriers, signs, trains_per_day, vehicles_per_day, train_speed, road_speed, visibility_m, last_overhaul_date, import_file_id, valid_from, valid_to) SELECT edition_id, id, line_id, station_id, territory_id, number, name, km, m, category, type, road, regulated, signalling, surface, barriers, signs, trains_per_day, vehicles_per_day, train_speed, road_speed, visibility_m, last_overhaul_date, import_file_id, valid_from, valid_to FROM crossing;

DROP TABLE crossing;

ALTER TABLE crossing_next RENAME TO crossing;

CREATE TRIGGER crossing_insert_guard BEFORE INSERT ON crossing
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER crossing_update_guard BEFORE UPDATE ON crossing
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER crossing_delete_guard BEFORE DELETE ON crossing
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

ALTER TABLE station_track ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));

ALTER TABLE station_switch ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));

ALTER TABLE territory ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));

CREATE TABLE crossing_line (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  crossing_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  UNIQUE (edition_id, crossing_id, line_id),
  FOREIGN KEY (edition_id, crossing_id) REFERENCES crossing(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (edition_id, line_id) REFERENCES line(edition_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;


-- Существующая однозначная привязка также доступна через новую связь.
INSERT INTO crossing_line (edition_id,id,crossing_id,line_id,import_file_id,valid_from,valid_to)
SELECT edition_id, 'legacy:' || id, id, line_id, import_file_id, valid_from, valid_to
FROM crossing WHERE line_id IS NOT NULL;

CREATE TRIGGER crossing_line_insert_guard BEFORE INSERT ON crossing_line
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER crossing_line_update_guard BEFORE UPDATE ON crossing_line
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER crossing_line_delete_guard BEFORE DELETE ON crossing_line
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
