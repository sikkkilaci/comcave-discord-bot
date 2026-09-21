-- CreateTable
CREATE TABLE "ComcaveLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "verifiedAt" DATETIME,
    "itExperienceLevel" TEXT,
    "interests" TEXT,
    "classId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "age" INTEGER,
    "locationId" TEXT,
    "profileCompletedAt" DATETIME,
    CONSTRAINT "Member_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Member_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Member_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ComcaveLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Member" ("classId", "createdAt", "discordId", "guildId", "id", "interests", "itExperienceLevel", "updatedAt", "verificationStatus", "verifiedAt") SELECT "classId", "createdAt", "discordId", "guildId", "id", "interests", "itExperienceLevel", "updatedAt", "verificationStatus", "verifiedAt" FROM "Member";
DROP TABLE "Member";
ALTER TABLE "new_Member" RENAME TO "Member";
CREATE INDEX "Member_classId_idx" ON "Member"("classId");
CREATE INDEX "Member_locationId_idx" ON "Member"("locationId");
CREATE UNIQUE INDEX "Member_guildId_discordId_key" ON "Member"("guildId", "discordId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ComcaveLocation_code_key" ON "ComcaveLocation"("code");

-- CreateIndex
CREATE INDEX "ComcaveLocation_isActive_idx" ON "ComcaveLocation"("isActive");
