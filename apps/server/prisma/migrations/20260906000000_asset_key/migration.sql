-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Asset_themeId_key_key" ON "Asset"("themeId", "key");
