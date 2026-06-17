-- CreateTable
CREATE TABLE "TableBan" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableBan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TableBan_tableId_idx" ON "TableBan"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "TableBan_tableId_userId_key" ON "TableBan"("tableId", "userId");

-- AddForeignKey
ALTER TABLE "TableBan" ADD CONSTRAINT "TableBan_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "LobbyTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBan" ADD CONSTRAINT "TableBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
