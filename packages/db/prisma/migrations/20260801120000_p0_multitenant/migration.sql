-- P0 multi-tenant migration (docs/architecture/17).
-- Data-safe order: create Shop -> add nullable shopId -> backfill Shop #1 ->
-- enforce NOT NULL -> re-key counters/StoreConfig -> swap global uniques for
-- composite per-shop uniques -> indexes. Safe on the live single-shop DB.

-- PHASE 1: tenant root
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Shop_slug_key" ON "Shop"("slug");

-- PHASE 2: add shopId as NULLABLE (existing rows stay valid)
ALTER TABLE "StaffUser" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "shopId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Category" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Brand" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Unit" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Product" ADD COLUMN "shopId" TEXT;
ALTER TABLE "ProductSaleUnit" ADD COLUMN "shopId" TEXT;
ALTER TABLE "ProductStock" ADD COLUMN "shopId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "shopId" TEXT;
ALTER TABLE "PriceSlab" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Batch" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "shopId" TEXT;
ALTER TABLE "GoodsReceipt" ADD COLUMN "shopId" TEXT;
ALTER TABLE "GrnLine" ADD COLUMN "shopId" TEXT;
ALTER TABLE "SupplierPayment" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Address" ADD COLUMN "shopId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shopId" TEXT;
ALTER TABLE "InvoiceLine" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "shopId" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN "shopId" TEXT;
ALTER TABLE "CreditNoteLine" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Order" ADD COLUMN "shopId" TEXT;
ALTER TABLE "OrderLine" ADD COLUMN "shopId" TEXT;
ALTER TABLE "StoreConfig" ADD COLUMN "shopId" TEXT;
ALTER TABLE "InvoiceCounter" ADD COLUMN "shopId" TEXT;
ALTER TABLE "CreditNoteCounter" ADD COLUMN "shopId" TEXT;
ALTER TABLE "ProcessedWebhook" ADD COLUMN "shopId" TEXT;
ALTER TABLE "IdempotencyKey" ADD COLUMN "shopId" TEXT;

-- PHASE 3: create Shop #1 and backfill every existing row
INSERT INTO "Shop" ("id","name","slug","status","plan","createdAt","updatedAt") VALUES ('shop_0001','Sadguru Kripa Hardware','shop-1','ACTIVE','FREE',now(),now());
UPDATE "Shop" AS s SET "name" = sc."name" FROM "StoreConfig" sc WHERE s."id"='shop_0001' AND sc."id"='default' AND sc."name" IS NOT NULL AND sc."name" <> '';
UPDATE "StaffUser" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Customer" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "AuditLog" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Category" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Brand" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Unit" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Product" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "ProductSaleUnit" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "ProductStock" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "StockMovement" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "PriceSlab" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Batch" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Reservation" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Supplier" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "GoodsReceipt" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "GrnLine" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "SupplierPayment" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Address" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "LedgerEntry" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Invoice" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "InvoiceLine" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Payment" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "CreditNote" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "CreditNoteLine" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "Order" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "OrderLine" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "StoreConfig" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "InvoiceCounter" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "CreditNoteCounter" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "ProcessedWebhook" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;
UPDATE "IdempotencyKey" SET "shopId"='shop_0001' WHERE "shopId" IS NULL;

-- PHASE 4: enforce NOT NULL (all except ProcessedWebhook, IdempotencyKey)
ALTER TABLE "StaffUser" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "AuditLog" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Brand" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Unit" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "ProductSaleUnit" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "ProductStock" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "PriceSlab" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Batch" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Reservation" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "GoodsReceipt" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "GrnLine" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "SupplierPayment" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Address" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "LedgerEntry" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "InvoiceLine" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "CreditNote" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "CreditNoteLine" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "StoreConfig" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "InvoiceCounter" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE "CreditNoteCounter" ALTER COLUMN "shopId" SET NOT NULL;

-- PHASE 5: re-key per-shop counters + StoreConfig
ALTER TABLE "InvoiceCounter" DROP CONSTRAINT "InvoiceCounter_pkey", ADD CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("shopId","fy");
ALTER TABLE "CreditNoteCounter" DROP CONSTRAINT "CreditNoteCounter_pkey", ADD CONSTRAINT "CreditNoteCounter_pkey" PRIMARY KEY ("shopId","fy");
ALTER TABLE "StoreConfig" ALTER COLUMN "id" DROP DEFAULT;

-- PHASE 6: swap global uniques for composite per-shop uniques
DROP INDEX "Brand_name_key";
DROP INDEX "Unit_code_key";
DROP INDEX "Product_sku_key";
DROP INDEX "Invoice_fy_invoiceNo_key";
DROP INDEX "CreditNote_fy_creditNoteNo_key";
DROP INDEX "Order_orderNo_key";
CREATE UNIQUE INDEX "Brand_shopId_name_key" ON "Brand"("shopId","name");
CREATE UNIQUE INDEX "Unit_shopId_code_key" ON "Unit"("shopId","code");
CREATE UNIQUE INDEX "Product_shopId_sku_key" ON "Product"("shopId","sku");
CREATE UNIQUE INDEX "Invoice_shopId_fy_invoiceNo_key" ON "Invoice"("shopId","fy","invoiceNo");
CREATE UNIQUE INDEX "CreditNote_shopId_fy_creditNoteNo_key" ON "CreditNote"("shopId","fy","creditNoteNo");
CREATE UNIQUE INDEX "Order_shopId_orderNo_key" ON "Order"("shopId","orderNo");
CREATE UNIQUE INDEX "StoreConfig_shopId_key" ON "StoreConfig"("shopId");

-- PHASE 7: shopId lookup indexes
CREATE INDEX "StaffUser_shopId_idx" ON "StaffUser"("shopId");
CREATE INDEX "Customer_shopId_idx" ON "Customer"("shopId");
CREATE INDEX "AuditLog_shopId_idx" ON "AuditLog"("shopId");
CREATE INDEX "Category_shopId_idx" ON "Category"("shopId");
CREATE INDEX "Brand_shopId_idx" ON "Brand"("shopId");
CREATE INDEX "Unit_shopId_idx" ON "Unit"("shopId");
CREATE INDEX "Product_shopId_idx" ON "Product"("shopId");
CREATE INDEX "ProductSaleUnit_shopId_idx" ON "ProductSaleUnit"("shopId");
CREATE INDEX "ProductStock_shopId_idx" ON "ProductStock"("shopId");
CREATE INDEX "StockMovement_shopId_idx" ON "StockMovement"("shopId");
CREATE INDEX "PriceSlab_shopId_idx" ON "PriceSlab"("shopId");
CREATE INDEX "Batch_shopId_idx" ON "Batch"("shopId");
CREATE INDEX "Reservation_shopId_idx" ON "Reservation"("shopId");
CREATE INDEX "Supplier_shopId_idx" ON "Supplier"("shopId");
CREATE INDEX "GoodsReceipt_shopId_idx" ON "GoodsReceipt"("shopId");
CREATE INDEX "GrnLine_shopId_idx" ON "GrnLine"("shopId");
CREATE INDEX "SupplierPayment_shopId_idx" ON "SupplierPayment"("shopId");
CREATE INDEX "Address_shopId_idx" ON "Address"("shopId");
CREATE INDEX "LedgerEntry_shopId_idx" ON "LedgerEntry"("shopId");
CREATE INDEX "Invoice_shopId_idx" ON "Invoice"("shopId");
CREATE INDEX "InvoiceLine_shopId_idx" ON "InvoiceLine"("shopId");
CREATE INDEX "Payment_shopId_idx" ON "Payment"("shopId");
CREATE INDEX "CreditNote_shopId_idx" ON "CreditNote"("shopId");
CREATE INDEX "CreditNoteLine_shopId_idx" ON "CreditNoteLine"("shopId");
CREATE INDEX "Order_shopId_idx" ON "Order"("shopId");
CREATE INDEX "OrderLine_shopId_idx" ON "OrderLine"("shopId");
CREATE INDEX "InvoiceCounter_shopId_idx" ON "InvoiceCounter"("shopId");
CREATE INDEX "CreditNoteCounter_shopId_idx" ON "CreditNoteCounter"("shopId");
CREATE INDEX "ProcessedWebhook_shopId_idx" ON "ProcessedWebhook"("shopId");
CREATE INDEX "IdempotencyKey_shopId_idx" ON "IdempotencyKey"("shopId");
