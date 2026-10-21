-- Исходная длина нужна для сверки с координатами и нестандартными км (#17).
ALTER TABLE subdivision_segment ADD COLUMN stated_length_m REAL;
