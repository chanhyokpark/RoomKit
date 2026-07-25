-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "onceRun" JSONB NOT NULL DEFAULT '[]';
