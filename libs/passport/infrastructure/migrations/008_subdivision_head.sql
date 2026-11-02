-- Руководители подразделений и название дистанции: лист «Руководители» шаблона ручных
-- данных (ADR-0051). Строка «Дистанция» несёт название дистанции; остальные — коды ПД и ПЧУ.
CREATE TABLE subdivision_head (
  edition_id INTEGER NOT NULL REFERENCES edition(id),
  id TEXT NOT NULL,
  subdivision TEXT NOT NULL CHECK (length(subdivision) BETWEEN 1 AND 50),
  title TEXT CHECK (title IS NULL OR length(title) <= 200),
  head TEXT CHECK (head IS NULL OR length(head) <= 100),
  import_file_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY (edition_id, id),
  CHECK (title IS NOT NULL OR head IS NOT NULL),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (edition_id, import_file_id) REFERENCES import_file(edition_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TRIGGER subdivision_head_insert_guard BEFORE INSERT ON subdivision_head
WHEN COALESCE((SELECT status FROM edition WHERE id = NEW.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER subdivision_head_update_guard BEFORE UPDATE ON subdivision_head
WHEN NEW.edition_id <> OLD.edition_id OR COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
CREATE TRIGGER subdivision_head_delete_guard BEFORE DELETE ON subdivision_head
WHEN COALESCE((SELECT status FROM edition WHERE id = OLD.edition_id), '') <> 'draft'
BEGIN SELECT RAISE(ABORT, 'edition is immutable'); END;
