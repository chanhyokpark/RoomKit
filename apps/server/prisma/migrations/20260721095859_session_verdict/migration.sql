-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('success', 'fail');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "verdict" "Verdict";
