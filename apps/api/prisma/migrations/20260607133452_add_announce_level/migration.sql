-- CreateEnum
CREATE TYPE "AnnounceLevel" AS ENUM ('TRUMPF', 'GEISS_BOCK', 'SLALOM', 'ALLES');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "announceLevel" "AnnounceLevel" NOT NULL DEFAULT 'ALLES';

-- AlterTable
ALTER TABLE "LobbyTable" ADD COLUMN     "announceLevel" "AnnounceLevel" NOT NULL DEFAULT 'ALLES';
