-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('test', 'production');

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('running', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('info', 'warn', 'error');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "mode" "SessionMode" NOT NULL,
    "state" "SessionState" NOT NULL DEFAULT 'running',
    "phaseId" TEXT,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "timerEndsAt" TIMESTAMP(3),
    "timerRemainingMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionDeviceCode" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "SessionDeviceCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionLog" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "LogLevel" NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,

    CONSTRAINT "SessionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_themeId_state_idx" ON "Session"("themeId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDeviceCode_code_key" ON "SessionDeviceCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDeviceCode_sessionId_deviceId_key" ON "SessionDeviceCode"("sessionId", "deviceId");

-- CreateIndex
CREATE INDEX "SessionLog_sessionId_id_idx" ON "SessionLog"("sessionId", "id");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDeviceCode" ADD CONSTRAINT "SessionDeviceCode_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionLog" ADD CONSTRAINT "SessionLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (Prisma cannot express partial indexes): at most one
-- non-ended production session per theme, race-proof at the DB level.
CREATE UNIQUE INDEX "Session_one_active_production_per_theme"
ON "Session"("themeId") WHERE "mode" = 'production' AND "state" <> 'ended';
