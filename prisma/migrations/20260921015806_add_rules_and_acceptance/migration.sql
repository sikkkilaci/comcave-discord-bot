-- CreateTable
CREATE TABLE "RuleSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RuleSet_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RuleAcceptance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "memberDiscordId" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "shownAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    CONSTRAINT "RuleAcceptance_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RuleAcceptance_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "RuleSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RuleSet_guildId_isActive_idx" ON "RuleSet"("guildId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RuleSet_guildId_version_key" ON "RuleSet"("guildId", "version");

-- CreateIndex
CREATE INDEX "RuleAcceptance_guildId_ruleSetId_idx" ON "RuleAcceptance"("guildId", "ruleSetId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleAcceptance_memberDiscordId_ruleSetId_key" ON "RuleAcceptance"("memberDiscordId", "ruleSetId");
