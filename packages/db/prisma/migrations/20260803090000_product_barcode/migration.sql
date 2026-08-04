-- Product barcode (docs/architecture/19 — myBillBook parity: scan-to-add + label print).
-- Nullable and NOT unique: two items may legitimately share a barcode (same EAN sold
-- under two shop SKUs), and most existing rows have none. Indexed per shop because the
-- only query is "find this shop's item by scanned code".
ALTER TABLE "Product" ADD COLUMN "barcode" TEXT;
CREATE INDEX "Product_shopId_barcode_idx" ON "Product"("shopId", "barcode");

-- Drop two indexes the P0 migration created that Postgres already covers: both counter
-- tables are keyed @@id([shopId, fy]), and that primary-key index has shopId as its
-- leading column, so a standalone shopId index is pure write overhead.
DROP INDEX IF EXISTS "InvoiceCounter_shopId_idx";
DROP INDEX IF EXISTS "CreditNoteCounter_shopId_idx";
