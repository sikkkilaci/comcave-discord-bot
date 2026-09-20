-- AlterTable
ALTER TABLE "Class" ADD COLUMN "leadDiscordId" TEXT;

-- CreateIndex
CREATE INDEX "Class_guildId_leadDiscordId_idx" ON "Class"("guildId", "leadDiscordId");
