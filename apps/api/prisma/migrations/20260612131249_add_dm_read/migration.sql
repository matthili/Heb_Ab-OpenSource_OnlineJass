-- CreateTable
CREATE TABLE "DmRead" (
    "userId" TEXT NOT NULL,
    "otherUserId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmRead_pkey" PRIMARY KEY ("userId","otherUserId")
);

-- CreateIndex
CREATE INDEX "DmRead_userId_idx" ON "DmRead"("userId");

-- AddForeignKey
ALTER TABLE "DmRead" ADD CONSTRAINT "DmRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
