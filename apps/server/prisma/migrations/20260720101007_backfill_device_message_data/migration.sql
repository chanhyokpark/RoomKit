-- Backfill data shapes for the assets-v2 schema:
-- device data gained displayName; message data changed from {payload} to {displayName, fields}.
UPDATE "Asset"
SET "data" = "data" || '{"displayName": ""}'::jsonb
WHERE "kind" = 'device' AND NOT ("data" ? 'displayName');

UPDATE "Asset"
SET "data" = '{"displayName": "", "fields": []}'::jsonb
WHERE "kind" = 'message' AND NOT ("data" ? 'fields');
