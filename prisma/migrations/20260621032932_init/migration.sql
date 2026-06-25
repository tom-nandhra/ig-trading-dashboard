-- CreateTable
CREATE TABLE "Trade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "closeId" TEXT NOT NULL,
    "openId" TEXT,
    "instrument" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "size" REAL NOT NULL,
    "openLevel" REAL,
    "closeLevel" REAL,
    "openDate" DATETIME,
    "closeDate" DATETIME NOT NULL,
    "currency" TEXT,
    "profitLoss" REAL NOT NULL,
    "fees" REAL NOT NULL DEFAULT 0,
    "durationSecs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Trade_closeId_key" ON "Trade"("closeId");
