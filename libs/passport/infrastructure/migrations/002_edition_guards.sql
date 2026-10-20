-- Редакции неизменяемы после ввода. Строки принадлежат своей редакции.
CREATE TRIGGER edition_insert_guard BEFORE INSERT ON edition
WHEN NEW.status <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition must start as draft'); END;
CREATE TRIGGER edition_delete_guard BEFORE DELETE ON edition
WHEN OLD.status <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER edition_update_guard BEFORE UPDATE ON edition
WHEN NEW.id <> OLD.id OR NEW.number <> OLD.number
  OR OLD.status = 'archived'
  OR (OLD.status = 'active' AND (NEW.status <> 'archived' OR NEW.date <> OLD.date OR NEW.label <> OLD.label))
  OR (OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'active'))
  OR (NEW.status <> OLD.status AND (NEW.date <> OLD.date OR NEW.label <> OLD.label))
BEGIN SELECT RAISE(ABORT, 'invalid edition transition'); END;

CREATE TRIGGER import_file_insert_guard BEFORE INSERT ON import_file
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER import_file_update_guard BEFORE UPDATE ON import_file
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER import_file_delete_guard BEFORE DELETE ON import_file
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER excluded_object_insert_guard BEFORE INSERT ON excluded_object
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER excluded_object_update_guard BEFORE UPDATE ON excluded_object
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER excluded_object_delete_guard BEFORE DELETE ON excluded_object
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER line_insert_guard BEFORE INSERT ON line
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER line_update_guard BEFORE UPDATE ON line
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER line_delete_guard BEFORE DELETE ON line
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER line_extent_insert_guard BEFORE INSERT ON line_extent
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER line_extent_update_guard BEFORE UPDATE ON line_extent
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER line_extent_delete_guard BEFORE DELETE ON line_extent
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER line_km_insert_guard BEFORE INSERT ON line_km
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER line_km_update_guard BEFORE UPDATE ON line_km
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER line_km_delete_guard BEFORE DELETE ON line_km
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER territory_insert_guard BEFORE INSERT ON territory
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER territory_update_guard BEFORE UPDATE ON territory
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER territory_delete_guard BEFORE DELETE ON territory
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER subdivision_insert_guard BEFORE INSERT ON subdivision
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER subdivision_update_guard BEFORE UPDATE ON subdivision
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER subdivision_delete_guard BEFORE DELETE ON subdivision
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER subdivision_segment_insert_guard BEFORE INSERT ON subdivision_segment
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER subdivision_segment_update_guard BEFORE UPDATE ON subdivision_segment
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER subdivision_segment_delete_guard BEFORE DELETE ON subdivision_segment
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER station_insert_guard BEFORE INSERT ON station
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_update_guard BEFORE UPDATE ON station
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_delete_guard BEFORE DELETE ON station
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER station_axis_insert_guard BEFORE INSERT ON station_axis
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_axis_update_guard BEFORE UPDATE ON station_axis
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_axis_delete_guard BEFORE DELETE ON station_axis
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER station_pd_insert_guard BEFORE INSERT ON station_pd
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_pd_update_guard BEFORE UPDATE ON station_pd
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_pd_delete_guard BEFORE DELETE ON station_pd
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER station_track_insert_guard BEFORE INSERT ON station_track
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_track_update_guard BEFORE UPDATE ON station_track
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_track_delete_guard BEFORE DELETE ON station_track
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER station_track_pd_insert_guard BEFORE INSERT ON station_track_pd
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_track_pd_update_guard BEFORE UPDATE ON station_track_pd
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_track_pd_delete_guard BEFORE DELETE ON station_track_pd
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER station_switch_insert_guard BEFORE INSERT ON station_switch
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_switch_update_guard BEFORE UPDATE ON station_switch
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_switch_delete_guard BEFORE DELETE ON station_switch
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER station_layout_insert_guard BEFORE INSERT ON station_layout
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_layout_update_guard BEFORE UPDATE ON station_layout
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_layout_delete_guard BEFORE DELETE ON station_layout
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER station_object_insert_guard BEFORE INSERT ON station_object
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_object_update_guard BEFORE UPDATE ON station_object
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER station_object_delete_guard BEFORE DELETE ON station_object
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER crossing_insert_guard BEFORE INSERT ON crossing
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER crossing_update_guard BEFORE UPDATE ON crossing
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER crossing_delete_guard BEFORE DELETE ON crossing
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER work_kind_insert_guard BEFORE INSERT ON work_kind
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER work_kind_update_guard BEFORE UPDATE ON work_kind
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER work_kind_delete_guard BEFORE DELETE ON work_kind
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER repair_norm_insert_guard BEFORE INSERT ON repair_norm
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER repair_norm_update_guard BEFORE UPDATE ON repair_norm
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER repair_norm_delete_guard BEFORE DELETE ON repair_norm
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER tolerance_insert_guard BEFORE INSERT ON tolerance
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER tolerance_update_guard BEFORE UPDATE ON tolerance
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER tolerance_delete_guard BEFORE DELETE ON tolerance
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER seg_class_insert_guard BEFORE INSERT ON seg_class
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_class_update_guard BEFORE UPDATE ON seg_class
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_class_delete_guard BEFORE DELETE ON seg_class
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER seg_load_insert_guard BEFORE INSERT ON seg_load
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_load_update_guard BEFORE UPDATE ON seg_load
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_load_delete_guard BEFORE DELETE ON seg_load
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER seg_speed_insert_guard BEFORE INSERT ON seg_speed
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_speed_update_guard BEFORE UPDATE ON seg_speed
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_speed_delete_guard BEFORE DELETE ON seg_speed
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER seg_rail_insert_guard BEFORE INSERT ON seg_rail
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_rail_update_guard BEFORE UPDATE ON seg_rail
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_rail_delete_guard BEFORE DELETE ON seg_rail
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER seg_sleeper_insert_guard BEFORE INSERT ON seg_sleeper
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_sleeper_update_guard BEFORE UPDATE ON seg_sleeper
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_sleeper_delete_guard BEFORE DELETE ON seg_sleeper
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER seg_ballast_insert_guard BEFORE INSERT ON seg_ballast
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_ballast_update_guard BEFORE UPDATE ON seg_ballast
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_ballast_delete_guard BEFORE DELETE ON seg_ballast
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

CREATE TRIGGER seg_train_pairs_insert_guard BEFORE INSERT ON seg_train_pairs
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_train_pairs_update_guard BEFORE UPDATE ON seg_train_pairs
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER seg_train_pairs_delete_guard BEFORE DELETE ON seg_train_pairs
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;

