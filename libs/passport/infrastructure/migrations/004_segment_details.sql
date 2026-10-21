-- Сохраняем типизированные характеристики без потери диапазонов и признаков.
ALTER TABLE seg_class ADD COLUMN stated_length_m REAL;
ALTER TABLE seg_class ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));
ALTER TABLE seg_load ADD COLUMN stated_length_m REAL;
ALTER TABLE seg_load ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));
ALTER TABLE seg_speed ADD COLUMN stated_length_m REAL;
ALTER TABLE seg_speed ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));
ALTER TABLE seg_rail ADD COLUMN stated_length_m REAL;
ALTER TABLE seg_rail ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));
ALTER TABLE seg_sleeper ADD COLUMN stated_length_m REAL;
ALTER TABLE seg_sleeper ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));
ALTER TABLE seg_ballast ADD COLUMN stated_length_m REAL;
ALTER TABLE seg_ballast ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));
