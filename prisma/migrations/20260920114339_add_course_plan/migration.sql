-- CreateTable
CREATE TABLE "CourseEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "courseNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trainer" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CourseEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseEntry_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseSpecialDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CourseSpecialDay_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseSpecialDay_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseAcknowledgment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "courseEntryId" TEXT NOT NULL,
    "memberDiscordId" TEXT NOT NULL,
    "acknowledgedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseAcknowledgment_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseAcknowledgment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseAcknowledgment_courseEntryId_fkey" FOREIGN KEY ("courseEntryId") REFERENCES "CourseEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseUpcomingNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "courseEntryId" TEXT NOT NULL,
    "notifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseUpcomingNotification_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseUpcomingNotification_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseUpcomingNotification_courseEntryId_fkey" FOREIGN KEY ("courseEntryId") REFERENCES "CourseEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CourseEntry_guildId_classId_startDate_idx" ON "CourseEntry"("guildId", "classId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "CourseEntry_classId_courseNumber_startDate_key" ON "CourseEntry"("classId", "courseNumber", "startDate");

-- CreateIndex
CREATE INDEX "CourseSpecialDay_guildId_classId_startDate_idx" ON "CourseSpecialDay"("guildId", "classId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "CourseSpecialDay_classId_startDate_endDate_label_key" ON "CourseSpecialDay"("classId", "startDate", "endDate", "label");

-- CreateIndex
CREATE INDEX "CourseAcknowledgment_guildId_classId_idx" ON "CourseAcknowledgment"("guildId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAcknowledgment_courseEntryId_memberDiscordId_key" ON "CourseAcknowledgment"("courseEntryId", "memberDiscordId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseUpcomingNotification_courseEntryId_key" ON "CourseUpcomingNotification"("courseEntryId");

-- CreateIndex
CREATE INDEX "CourseUpcomingNotification_guildId_classId_idx" ON "CourseUpcomingNotification"("guildId", "classId");
