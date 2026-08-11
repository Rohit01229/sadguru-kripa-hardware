-- Partial receipt of purchase orders (docs/architecture/21c §7).
--
-- An order can now be received in more than one lot, so the single
-- PurchaseOrder.receivedGrnId pointer is replaced by GoodsReceipt.purchaseOrderId
-- (many receipts per order), and each line tracks how much has actually arrived.
--
-- The DROP COLUMN / DROP INDEX below are safe: PurchaseOrder and PurchaseOrderLine
-- were both verified EMPTY (0 rows) immediately before this migration was generated,
-- and the dropped column shipped only in the immediately preceding commit. The new
-- NOT NULL "baseQty" carries no default for the same reason — there are no rows to
-- back-fill.

-- AlterEnum
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'PARTIAL';

-- DropIndex
DROP INDEX "PurchaseOrder_receivedGrnId_key";

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "purchaseOrderId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" DROP COLUMN "receivedGrnId";

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "baseQty" DECIMAL(14,3) NOT NULL,
ADD COLUMN     "receivedBaseQty" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

