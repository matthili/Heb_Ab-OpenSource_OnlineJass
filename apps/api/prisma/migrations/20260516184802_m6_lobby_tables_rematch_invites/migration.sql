-- CreateEnum
CREATE TYPE "LobbyTableStatus" AS ENUM ('WAITING', 'IN_GAME', 'POST_GAME', 'CLOSED');

-- CreateEnum
CREATE TYPE "JoinMode" AS ENUM ('OPEN', 'REQUEST', 'INVITE');

-- CreateEnum
CREATE TYPE "RestartMode" AS ENUM ('WELI', 'SIEGER_GIBT');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RematchVoteValue" AS ENUM ('YES', 'NO');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "tableId" TEXT;

-- CreateTable
CREATE TABLE "LobbyTable" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "joinMode" "JoinMode" NOT NULL DEFAULT 'OPEN',
    "variant" "GameVariant" NOT NULL DEFAULT 'KREUZ_4P',
    "aiSeatType" TEXT NOT NULL DEFAULT 'random',
    "autoFillSeconds" INTEGER DEFAULT 30,
    "restartMode" "RestartMode" NOT NULL DEFAULT 'SIEGER_GIBT',
    "status" "LobbyTableStatus" NOT NULL DEFAULT 'WAITING',
    "currentGameId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "LobbyTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyTableSeat" (
    "tableId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "userId" TEXT,
    "aiSeatType" TEXT,
    "joinOrder" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LobbyTableSeat_pkey" PRIMARY KEY ("tableId","seat")
);

-- CreateTable
CREATE TABLE "GameJoinRequest" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "GameJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableInvite" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "inviteeUserId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TableInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RematchVote" (
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vote" "RematchVoteValue" NOT NULL,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RematchVote_pkey" PRIMARY KEY ("gameId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LobbyTable_currentGameId_key" ON "LobbyTable"("currentGameId");

-- CreateIndex
CREATE INDEX "LobbyTable_status_idx" ON "LobbyTable"("status");

-- CreateIndex
CREATE INDEX "LobbyTable_createdAt_idx" ON "LobbyTable"("createdAt");

-- CreateIndex
CREATE INDEX "LobbyTable_ownerId_idx" ON "LobbyTable"("ownerId");

-- CreateIndex
CREATE INDEX "LobbyTableSeat_userId_idx" ON "LobbyTableSeat"("userId");

-- CreateIndex
CREATE INDEX "GameJoinRequest_tableId_status_idx" ON "GameJoinRequest"("tableId", "status");

-- CreateIndex
CREATE INDEX "GameJoinRequest_userId_idx" ON "GameJoinRequest"("userId");

-- CreateIndex
CREATE INDEX "TableInvite_inviteeUserId_status_idx" ON "TableInvite"("inviteeUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TableInvite_tableId_inviteeUserId_key" ON "TableInvite"("tableId", "inviteeUserId");

-- CreateIndex
CREATE INDEX "Game_tableId_idx" ON "Game"("tableId");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "LobbyTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyTable" ADD CONSTRAINT "LobbyTable_currentGameId_fkey" FOREIGN KEY ("currentGameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyTable" ADD CONSTRAINT "LobbyTable_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyTableSeat" ADD CONSTRAINT "LobbyTableSeat_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "LobbyTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyTableSeat" ADD CONSTRAINT "LobbyTableSeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameJoinRequest" ADD CONSTRAINT "GameJoinRequest_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "LobbyTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameJoinRequest" ADD CONSTRAINT "GameJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableInvite" ADD CONSTRAINT "TableInvite_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "LobbyTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableInvite" ADD CONSTRAINT "TableInvite_inviteeUserId_fkey" FOREIGN KEY ("inviteeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableInvite" ADD CONSTRAINT "TableInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematchVote" ADD CONSTRAINT "RematchVote_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematchVote" ADD CONSTRAINT "RematchVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
