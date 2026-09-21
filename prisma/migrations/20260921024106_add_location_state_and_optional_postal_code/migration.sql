/*
  Warnings:

  - Added the required column `state` to the `ComcaveLocation` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ComcaveLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postalCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ComcaveLocation" ("city", "code", "createdAt", "id", "isActive", "name", "postalCode", "updatedAt") SELECT "city", "code", "createdAt", "id", "isActive", "name", "postalCode", "updatedAt" FROM "ComcaveLocation";
DROP TABLE "ComcaveLocation";
ALTER TABLE "new_ComcaveLocation" RENAME TO "ComcaveLocation";
CREATE UNIQUE INDEX "ComcaveLocation_code_key" ON "ComcaveLocation"("code");
CREATE INDEX "ComcaveLocation_isActive_idx" ON "ComcaveLocation"("isActive");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
