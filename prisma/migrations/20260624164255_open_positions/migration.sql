/*
  Warnings:

  - Made the column `openId` on table `Trade` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Trade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "openId" TEXT NOT NULL,
    "closeId" TEXT,
    "instrument" TEXT NOT NULL,
    "direction" TEXT,
    "size" REAL,
    "openLevel" REAL,
    "closeLevel" REAL,
    "openDate" DATETIME,
    "closeDate" DATETIME,
    "currency" TEXT,
    "profitLoss" REAL,
    "fees" REAL NOT NULL DEFAULT 0,
    "durationSecs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Trade" ("closeDate", "closeId", "closeLevel", "createdAt", "currency", "direction", "durationSecs", "fees", "id", "instrument", "openDate", "openId", "openLevel", "profitLoss", "size") SELECT "closeDate", "closeId", "closeLevel", "createdAt", "currency", "direction", "durationSecs", "fees", "id", "instrument", "openDate", "openId", "openLevel", "profitLoss", "size" FROM "Trade";
DROP TABLE "Trade";
ALTER TABLE "new_Trade" RENAME TO "Trade";
CREATE UNIQUE INDEX "Trade_openId_key" ON "Trade"("openId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
