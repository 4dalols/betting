-- CreateTable
CREATE TABLE "ExGame" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "hostToken" TEXT NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'LOBBY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caseSecs" INTEGER NOT NULL DEFAULT 600,
    "stepSecs" INTEGER NOT NULL DEFAULT 60,
    "customerRate" INTEGER NOT NULL DEFAULT 10,
    "positionLimit" INTEGER NOT NULL DEFAULT 1000000,
    "maxOrderSize" INTEGER NOT NULL DEFAULT 1000,
    "maxOpenOrders" INTEGER NOT NULL DEFAULT 100,
    "seed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "seq" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB,
    "advancedAt" TIMESTAMP(3),

    CONSTRAINT "ExGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExPlayer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pnl" DOUBLE PRECISION,

    CONSTRAINT "ExPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExGame_code_key" ON "ExGame"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ExGame_hostToken_key" ON "ExGame"("hostToken");

-- CreateIndex
CREATE UNIQUE INDEX "ExPlayer_token_key" ON "ExPlayer"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ExPlayer_gameId_name_key" ON "ExPlayer"("gameId", "name");

-- AddForeignKey
ALTER TABLE "ExPlayer" ADD CONSTRAINT "ExPlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "ExGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

