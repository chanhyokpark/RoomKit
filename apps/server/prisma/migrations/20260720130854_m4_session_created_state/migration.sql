-- Add 'created' to SessionState. Postgres cannot use a value added by
-- ALTER TYPE ... ADD VALUE inside the same transaction, so the enum is
-- recreated instead. The partial unique index references "state" in its
-- predicate, so it is dropped and recreated around the type swap.
DROP INDEX "Session_one_active_production_per_theme";

CREATE TYPE "SessionState_new" AS ENUM ('created', 'running', 'paused', 'ended');
ALTER TABLE "Session" ALTER COLUMN "state" DROP DEFAULT;
ALTER TABLE "Session"
  ALTER COLUMN "state" TYPE "SessionState_new"
  USING ("state"::text::"SessionState_new");
ALTER TYPE "SessionState" RENAME TO "SessionState_old";
ALTER TYPE "SessionState_new" RENAME TO "SessionState";
DROP TYPE "SessionState_old";
ALTER TABLE "Session" ALTER COLUMN "state" SET DEFAULT 'created';

CREATE UNIQUE INDEX "Session_one_active_production_per_theme"
ON "Session"("themeId") WHERE "mode" = 'production' AND "state" <> 'ended';

-- Test codes of ended sessions are dead weight now that codes are
-- operator-entered and freed on session end.
DELETE FROM "SessionDeviceCode" sdc
USING "Session" s
WHERE sdc."sessionId" = s."id" AND s."state" = 'ended';
