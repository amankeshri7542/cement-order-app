ALTER TABLE "Product" ADD CONSTRAINT "product_money_stock" CHECK ("pricePaise" > 0 AND "stock" >= 0 AND "priceVersion" > 0 AND "version" > 0);
ALTER TABLE "CartItem" ADD CONSTRAINT "cart_quantity" CHECK ("quantity" BETWEEN 1 AND 10000 AND "seenPricePaise" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "order_totals" CHECK ("subtotalPaise" >= 0 AND "deliveryFeePaise" >= 0 AND "totalPaise" = "subtotalPaise" + "deliveryFeePaise");
ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_totals" CHECK ("pricePaise" > 0 AND "quantity" > 0 AND "lineTotalPaise" = "pricePaise"::bigint * "quantity");
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount" CHECK ("amountPaise" > 0);
ALTER TABLE "QuoteItem" ADD CONSTRAINT "quote_item_values" CHECK ("quantity" > 0 AND ("unitPricePaise" IS NULL OR "unitPricePaise" > 0));
ALTER TABLE "StoreSettings" ADD CONSTRAINT "store_policy" CHECK ("id" = 'store' AND "deliveryFeePaise" >= 0 AND ("freeDeliveryAbovePaise" IS NULL OR "freeDeliveryAbovePaise" >= 0));
