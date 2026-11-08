-- Each firm's stock is its own (plan v4, two firms). Goods reach the other firm only as a sale bill
-- and a purchase, never as a transfer, whichever code writes the row.
CREATE FUNCTION transfer_same_firm() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "firmId" FROM "Location" WHERE id = NEW."fromLocationId")
     IS DISTINCT FROM (SELECT "firmId" FROM "Location" WHERE id = NEW."toLocationId") THEN
    RAISE EXCEPTION 'OTHER_FIRM: stock goes to another firm only with a bill';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_transfer_same_firm BEFORE INSERT ON "StockTransfer" FOR EACH ROW EXECUTE FUNCTION transfer_same_firm();
