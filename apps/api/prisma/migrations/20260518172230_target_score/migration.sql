-- AlterEnum
ALTER TYPE "LobbyTableStatus" ADD VALUE 'MATCH_OVER';

-- AlterTable
ALTER TABLE "LobbyTable" ADD COLUMN     "cumulativeScoreTeam0" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cumulativeScoreTeam1" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "targetScore" INTEGER NOT NULL DEFAULT 1000;
