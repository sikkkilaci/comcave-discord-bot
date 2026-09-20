-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "topics" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "relatedMaterials" TEXT,
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyReport_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DailyReport_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "calendarWeek" INTEGER NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "topics" TEXT NOT NULL,
    "progress" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeeklyReport_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeeklyReport_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DailyReport_guildId_classId_date_idx" ON "DailyReport"("guildId", "classId", "date");

-- CreateIndex
CREATE INDEX "WeeklyReport_guildId_classId_year_calendarWeek_idx" ON "WeeklyReport"("guildId", "classId", "year", "calendarWeek");
