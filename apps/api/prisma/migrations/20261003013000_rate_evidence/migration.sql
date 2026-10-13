CREATE OR REPLACE FUNCTION protect_rate_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."sha256",OLD."storageKey",OLD."contentType",OLD."size",OLD."fileName",OLD."createdBy",OLD."createdAt") IS DISTINCT FROM (NEW."sha256",NEW."storageKey",NEW."contentType",NEW."size",NEW."fileName",NEW."createdBy",NEW."createdAt") THEN RAISE EXCEPTION 'Rate source evidence is immutable'; END IF;
  IF OLD."ocrText" IS NOT NULL AND (OLD."ocrText",OLD."ocr") IS DISTINCT FROM (NEW."ocrText",NEW."ocr") THEN RAISE EXCEPTION 'Saved OCR evidence is immutable'; END IF;
  RETURN NEW;
END; $$;
