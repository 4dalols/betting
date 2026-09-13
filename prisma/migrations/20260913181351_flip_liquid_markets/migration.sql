-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'LIQUIDITY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MarketType" ADD VALUE 'FLIP';
ALTER TYPE "MarketType" ADD VALUE 'LIQUID';

-- AlterTable
ALTER TABLE "Bet" ADD COLUMN     "shares" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "liquidityCents" INTEGER;

-- AlterTable
ALTER TABLE "Outcome" ADD COLUMN     "shares" DOUBLE PRECISION NOT NULL DEFAULT 0;
