-- Revert of the component asset system: delete component assets, scrub their
-- attachment refs out of remaining asset data, and drop the enum value.
DELETE FROM "Asset" WHERE "kind" = 'component';

UPDATE "Asset" SET "data" = "data" - 'hintCodeComponent' WHERE "kind" = 'device';
UPDATE "Asset" SET "data" = "data" - 'component'         WHERE "kind" = 'video';
UPDATE "Asset" SET "data" = "data" - 'subtitleComponent' WHERE "kind" IN ('dialogue', 'player');

-- Postgres cannot drop an enum value in place: rebuild the type and cast.
ALTER TYPE "AssetKind" RENAME TO "AssetKind_old";
CREATE TYPE "AssetKind" AS ENUM ('device', 'bgm', 'dialogue', 'sfx', 'video', 'image', 'file', 'hint', 'player', 'website', 'message', 'phase', 'event');
ALTER TABLE "Asset" ALTER COLUMN "kind" TYPE "AssetKind" USING ("kind"::text::"AssetKind");
DROP TYPE "AssetKind_old";
