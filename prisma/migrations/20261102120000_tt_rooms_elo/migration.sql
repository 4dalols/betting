-- Trade or Tighten v2 (rooms, Elo, spread-width tightening). Game data is ephemeral, so the v1 tables are replaced.
DROP TABLE IF EXISTS "TtTrade", "TtQuote", "TtBid", "TtInfoItem", "TtRound", "TtPlayer", "TtGame" CASCADE;
DROP TYPE IF EXISTS "TtPhase";
DROP TYPE IF EXISTS "TtDistribution";
DROP TYPE IF EXISTS "TtAuctionType";
DROP TYPE IF EXISTS "TtSide";

-- CreateEnum
CREATE TYPE "TtPhase" AS ENUM ('AUCTION', 'TIGHTEN', 'QUOTE', 'TRADE', 'RESULTS');

-- CreateEnum
CREATE TYPE "TtDistribution" AS ENUM ('SKEWED', 'UNIFORM');

-- CreateEnum
CREATE TYPE "TtSide" AS ENUM ('BUY', 'SELL', 'PASS');

-- CreateTable
CREATE TABLE "TtGame" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "hostToken" TEXT NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'LOBBY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "distribution" "TtDistribution" NOT NULL DEFAULT 'SKEWED',
    "totalRounds" INTEGER NOT NULL DEFAULT 4,
    "cardsPerRound" INTEGER NOT NULL DEFAULT 4,
    "roomSize" INTEGER NOT NULL DEFAULT 4,
    "cycles" INTEGER NOT NULL DEFAULT 2,
    "tightenPct" INTEGER NOT NULL DEFAULT 10,
    "auctionSecs" INTEGER NOT NULL DEFAULT 60,
    "decisionSecs" INTEGER NOT NULL DEFAULT 15,
    "tradeSecs" INTEGER NOT NULL DEFAULT 30,
    "breakSecs" INTEGER NOT NULL DEFAULT 5,
    "roundBreakSecs" INTEGER NOT NULL DEFAULT 20,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "roundBreakEndsAt" TIMESTAMP(3),
    "seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TtGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtPlayer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "elo" DOUBLE PRECISION NOT NULL DEFAULT 1200,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TtPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtRoom" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "cards" INTEGER[],
    "phase" "TtPhase" NOT NULL DEFAULT 'AUCTION',
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "opensAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "seq" INTEGER NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "TtRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtSeat" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "eloBefore" DOUBLE PRECISION NOT NULL,
    "tradingPnl" DOUBLE PRECISION,
    "normalized" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "score" DOUBLE PRECISION,
    "eloAfter" DOUBLE PRECISION,

    CONSTRAINT "TtSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtInfoItem" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "winnerId" TEXT,
    "price" DOUBLE PRECISION,

    CONSTRAINT "TtInfoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtBid" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "amounts" DOUBLE PRECISION[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TtBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtTighten" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "width" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TtTighten_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtMarket" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "makerId" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "bid" DOUBLE PRECISION,
    "ask" DOUBLE PRECISION,
    "auto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TtMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtTrade" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "side" "TtSide" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TtTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TtGame_code_key" ON "TtGame"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TtGame_hostToken_key" ON "TtGame"("hostToken");

-- CreateIndex
CREATE UNIQUE INDEX "TtPlayer_token_key" ON "TtPlayer"("token");

-- CreateIndex
CREATE UNIQUE INDEX "TtPlayer_gameId_name_key" ON "TtPlayer"("gameId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TtRoom_gameId_round_index_key" ON "TtRoom"("gameId", "round", "index");

-- CreateIndex
CREATE UNIQUE INDEX "TtSeat_roomId_playerId_key" ON "TtSeat"("roomId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "TtInfoItem_roomId_index_key" ON "TtInfoItem"("roomId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "TtBid_roomId_playerId_key" ON "TtBid"("roomId", "playerId");

-- CreateIndex
CREATE INDEX "TtTighten_roomId_cycle_idx" ON "TtTighten"("roomId", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "TtMarket_roomId_cycle_key" ON "TtMarket"("roomId", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "TtTrade_roomId_cycle_playerId_key" ON "TtTrade"("roomId", "cycle", "playerId");

-- AddForeignKey
ALTER TABLE "TtPlayer" ADD CONSTRAINT "TtPlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TtGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtRoom" ADD CONSTRAINT "TtRoom_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TtGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtSeat" ADD CONSTRAINT "TtSeat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TtRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtSeat" ADD CONSTRAINT "TtSeat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "TtPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtInfoItem" ADD CONSTRAINT "TtInfoItem_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TtRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtInfoItem" ADD CONSTRAINT "TtInfoItem_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "TtPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtBid" ADD CONSTRAINT "TtBid_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TtRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtBid" ADD CONSTRAINT "TtBid_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "TtPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtTighten" ADD CONSTRAINT "TtTighten_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TtRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtTighten" ADD CONSTRAINT "TtTighten_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "TtPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtMarket" ADD CONSTRAINT "TtMarket_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TtRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtMarket" ADD CONSTRAINT "TtMarket_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "TtPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtTrade" ADD CONSTRAINT "TtTrade_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TtRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtTrade" ADD CONSTRAINT "TtTrade_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "TtPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
