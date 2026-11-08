-- Plan v4 B4b: the desk's search finds customers by a piece of their name or number, and orders
-- by a piece of their number. pg_trgm comes from 20261002120000_pilot_operations.
CREATE INDEX "User_name_trgm_idx" ON "User" USING gin ("name" gin_trgm_ops);
CREATE INDEX "User_phone_trgm_idx" ON "User" USING gin ("phone" gin_trgm_ops);
CREATE INDEX "Order_number_trgm_idx" ON "Order" USING gin ("number" gin_trgm_ops);
