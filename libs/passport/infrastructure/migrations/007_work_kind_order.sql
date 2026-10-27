-- Порядок видов работ из листа «Виды работ»: в нём строки выводятся в таблицах плана
-- (ADR-0032). Прежние строки остаются без номера и читаются по идентификатору, как раньше.
ALTER TABLE work_kind ADD COLUMN sort_order INTEGER CHECK (sort_order IS NULL OR sort_order >= 0);
