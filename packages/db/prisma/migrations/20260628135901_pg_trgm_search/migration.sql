-- Search indexes (13 "Indexes & constraints"; 03 §11).
-- pg_trgm powers fuzzy / typeahead ILIKE + similarity search on the counter
-- and storefront. GIN trigram indexes on Product.name, Product.sku, Brand.name.
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx"
  ON "Product" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx"
  ON "Product" USING gin ("sku" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Brand_name_trgm_idx"
  ON "Brand" USING gin ("name" gin_trgm_ops);
