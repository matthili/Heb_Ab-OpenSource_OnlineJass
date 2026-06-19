-- CreateTable
CREATE TABLE "UsernameHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "untilAt" TIMESTAMP(3),

    CONSTRAINT "UsernameHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsernameHistory_userId_idx" ON "UsernameHistory"("userId");

-- CreateIndex
CREATE INDEX "UsernameHistory_name_untilAt_idx" ON "UsernameHistory"("name", "untilAt");

-- AddForeignKey
ALTER TABLE "UsernameHistory" ADD CONSTRAINT "UsernameHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
