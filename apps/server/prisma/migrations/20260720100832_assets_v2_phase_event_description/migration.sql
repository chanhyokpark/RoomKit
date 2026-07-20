/*
  Warnings:

  - You are about to drop the `Event` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Phase` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssetKind" ADD VALUE 'phase';
ALTER TYPE "AssetKind" ADD VALUE 'event';

-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_themeId_fkey";

-- DropForeignKey
ALTER TABLE "Phase" DROP CONSTRAINT "Phase_themeId_fkey";

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '';

-- DropTable
DROP TABLE "Event";

-- DropTable
DROP TABLE "Phase";

-- DropEnum
DROP TYPE "TriggerKind";
