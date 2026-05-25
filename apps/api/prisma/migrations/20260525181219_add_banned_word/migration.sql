-- CreateTable
CREATE TABLE "BannedWord" (
    "id" SERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannedWord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BannedWord_word_key" ON "BannedWord"("word");

-- CreateIndex
CREATE INDEX "BannedWord_createdAt_idx" ON "BannedWord"("createdAt");
