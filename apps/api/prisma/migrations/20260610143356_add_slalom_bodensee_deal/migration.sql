-- AlterTable
ALTER TABLE "RoundDecision" ADD COLUMN     "bodenseeDeal" JSONB,
ADD COLUMN     "slalom" BOOLEAN NOT NULL DEFAULT false;
