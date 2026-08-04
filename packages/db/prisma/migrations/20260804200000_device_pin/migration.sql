-- Device PIN for fast re-login. The PIN is only ever accepted alongside the device
-- token it was created for, so it is two factors, not a weaker password. Both are
-- stored hashed; the attempt counter is what makes a 4-digit secret safe.
-- CreateTable
CREATE TABLE "StaffPin" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "label" TEXT,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffPin_deviceHash_key" ON "StaffPin"("deviceHash");

-- CreateIndex
CREATE INDEX "StaffPin_staffUserId_idx" ON "StaffPin"("staffUserId");

-- AddForeignKey
ALTER TABLE "StaffPin" ADD CONSTRAINT "StaffPin_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

