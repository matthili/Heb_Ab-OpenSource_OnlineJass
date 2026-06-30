-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "allowGumpf" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LobbyTable" ADD COLUMN     "allowGumpf" BOOLEAN NOT NULL DEFAULT false;
