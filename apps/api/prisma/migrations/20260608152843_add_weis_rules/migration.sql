-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "sackRule" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weisNeedsTrick" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LobbyTable" ADD COLUMN     "sackRule" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "weisNeedsTrick" BOOLEAN NOT NULL DEFAULT false;
