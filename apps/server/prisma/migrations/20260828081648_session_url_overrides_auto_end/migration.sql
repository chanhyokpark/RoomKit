-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "autoEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "urlOverrides" JSONB NOT NULL DEFAULT '{}';
