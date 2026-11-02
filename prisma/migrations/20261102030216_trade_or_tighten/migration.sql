-- CreateEnum
CREATE TYPE "TtPhase" AS ENUM ('AUCTION', 'QUOTE', 'TRADE', 'RESULTS');

-- CreateEnum
CREATE TYPE "TtDistribution" AS ENUM ('SKEWED', 'UNIFORM');

-- CreateEnum
CREATE TYPE "TtAuctionType" AS ENUM ('FIRST_PRICE', 'SECOND_PRICE');

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
    "cardsPerRound" INTEGER NOT NULL DEFAULT 4,
    "itemsPerRound" INTEGER NOT NULL DEFAULT 4,
    "sortedInfo" BOOLEAN NOT NULL DEFAULT true,
    "auctionType" "TtAuctionType" NOT NULL DEFAULT 'SECOND_PRICE',
    "bankroll" INTEGER NOT NULL DEFAULT 100,
    "resetBankroll" BOOLEAN NOT NULL DEFAULT false,
    "subRounds" INTEGER NOT NULL DEFAULT 2,
    "tightenPct" INTEGER NOT NULL DEFAULT 10,
    "maxSpread" DOUBLE PRECISION,
    "auctionSecs" INTEGER NOT NULL DEFAULT 30,
    "quoteSecs" INTEGER NOT NULL DEFAULT 30,
    "tradeSecs" INTEGER NOT NULL DEFAULT 30,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "phase" "TtPhase" NOT NULL DEFAULT 'AUCTION',
    "itemIndex" INTEGER NOT NULL DEFAULT 0,
    "subRound" INTEGER NOT NULL DEFAULT 0,
    "phaseEndsAt" TIMESTAMP(3),
    "seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TtGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtPlayer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TtPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtRound" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "cards" INTEGER[],
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "TtRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtInfoItem" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "winnerId" TEXT,
    "price" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "TtInfoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtBid" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TtBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtQuote" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "subRound" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "bid" DOUBLE PRECISION NOT NULL,
    "ask" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TtQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TtTrade" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "subRound" INTEGER NOT NULL,
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
CREATE UNIQUE INDEX "TtRound_gameId_index_key" ON "TtRound"("gameId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "TtInfoItem_roundId_index_key" ON "TtInfoItem"("roundId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "TtBid_itemId_playerId_key" ON "TtBid"("itemId", "playerId");

-- CreateIndex
CREATE INDEX "TtQuote_roundId_subRound_idx" ON "TtQuote"("roundId", "subRound");

-- CreateIndex
CREATE UNIQUE INDEX "TtTrade_roundId_subRound_playerId_key" ON "TtTrade"("roundId", "subRound", "playerId");

-- AddForeignKey
ALTER TABLE "TtPlayer" ADD CONSTRAINT "TtPlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TtGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtRound" ADD CONSTRAINT "TtRound_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TtGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtInfoItem" ADD CONSTRAINT "TtInfoItem_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "TtRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtInfoItem" ADD CONSTRAINT "TtInfoItem_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "TtPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtBid" ADD CONSTRAINT "TtBid_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "TtInfoItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtBid" ADD CONSTRAINT "TtBid_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "TtPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtQuote" ADD CONSTRAINT "TtQuote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "TtRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtQuote" ADD CONSTRAINT "TtQuote_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "TtPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtTrade" ADD CONSTRAINT "TtTrade_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "TtRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TtTrade" ADD CONSTRAINT "TtTrade_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "TtPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
