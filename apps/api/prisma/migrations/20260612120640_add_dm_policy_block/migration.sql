-- CreateEnum
CREATE TYPE "DmPolicy" AS ENUM ('ALL', 'FRIENDS');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "dmPolicy" "DmPolicy" NOT NULL DEFAULT 'ALL';

-- CreateTable
CREATE TABLE "DmBlock" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmBlock_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateIndex
CREATE INDEX "DmBlock_blockedId_idx" ON "DmBlock"("blockedId");

-- AddForeignKey
ALTER TABLE "DmBlock" ADD CONSTRAINT "DmBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmBlock" ADD CONSTRAINT "DmBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
