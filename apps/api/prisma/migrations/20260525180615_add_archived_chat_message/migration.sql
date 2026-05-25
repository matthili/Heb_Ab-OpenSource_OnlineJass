-- CreateTable
CREATE TABLE "ArchivedChatMessage" (
    "id" BIGSERIAL NOT NULL,
    "channel" "ChatChannel" NOT NULL,
    "channelKey" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gameId" TEXT,

    CONSTRAINT "ArchivedChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchivedChatMessage_channelKey_createdAt_idx" ON "ArchivedChatMessage"("channelKey", "createdAt");

-- CreateIndex
CREATE INDEX "ArchivedChatMessage_archivedAt_idx" ON "ArchivedChatMessage"("archivedAt");

-- CreateIndex
CREATE INDEX "ArchivedChatMessage_senderId_idx" ON "ArchivedChatMessage"("senderId");

-- AddForeignKey
ALTER TABLE "ArchivedChatMessage" ADD CONSTRAINT "ArchivedChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchivedChatMessage" ADD CONSTRAINT "ArchivedChatMessage_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
