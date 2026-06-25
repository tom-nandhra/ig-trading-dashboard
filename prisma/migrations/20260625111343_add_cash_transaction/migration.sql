/*
  Warnings:

  - You are about to drop the column `dedupeKey` on the `CashTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `transactionType` on the `CashTransaction` table. All the data in the column will be lost.
  - Added the required column `type` to the `CashTransaction` table without a default value. This is not possible if the table is not empty.
  - Made the column `reference` on table `CashTransaction` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CashTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_CashTransaction" ("amount", "createdAt", "date", "id", "reference") SELECT "amount", "createdAt", "date", "id", "reference" FROM "CashTransaction";
DROP TABLE "CashTransaction";
ALTER TABLE "new_CashTransaction" RENAME TO "CashTransaction";
CREATE UNIQUE INDEX "CashTransaction_reference_key" ON "CashTransaction"("reference");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
