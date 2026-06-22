-- CreateEnum
CREATE TYPE "WinMode" AS ENUM ('FIRST_TO_TARGET', 'HIGHEST');

-- AlterTable
ALTER TABLE "LobbyTable" ADD COLUMN     "matchWinnerTeam" INTEGER,
ADD COLUMN     "winMode" "WinMode" NOT NULL DEFAULT 'FIRST_TO_TARGET';
