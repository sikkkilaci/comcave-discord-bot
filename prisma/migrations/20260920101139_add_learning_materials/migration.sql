-- CreateTable
CREATE TABLE "LearningMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "url" TEXT,
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "attachmentContentType" TEXT,
    "linkedType" TEXT,
    "linkedId" TEXT,
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningMaterial_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearningMaterial_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LearningMaterial_guildId_classId_category_idx" ON "LearningMaterial"("guildId", "classId", "category");
