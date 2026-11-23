-- AlterTable
ALTER TABLE "ExGame" ADD COLUMN     "chart" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "pnlHistory" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "snap" JSONB;

-- AlterTable
ALTER TABLE "ExPlayer" ADD COLUMN     "fills" JSONB NOT NULL DEFAULT '[]';

-- Move fills, chart and P&L history out of existing games' state.
UPDATE "ExPlayer" p SET "fills" = COALESCE(g."state"->'fills'->p."id", '[]')
FROM "ExGame" g WHERE p."gameId" = g."id" AND g."state" IS NOT NULL;

UPDATE "ExGame" SET
  "chart" = COALESCE("state"->'chart', '[]'),
  "pnlHistory" = COALESCE("state"->'pnlHistory', '[]'),
  "state" = "state" - 'fills' - 'chart' - 'pnlHistory'
WHERE "state" IS NOT NULL;
