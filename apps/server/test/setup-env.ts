import { hashSync } from 'bcryptjs';

// Runs before any module import. e2e tests always target the roomkit_test DB
// (created by docker/postgres-init.sql) with fixed credentials, regardless of .env.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://roomkit:roomkit@localhost:5433/roomkit_test';
process.env.JWT_SECRET = 'e2e-test-secret-not-for-production';
process.env.ADMIN_ID = 'test-admin';
process.env.ADMIN_PASSWORD_HASH = hashSync('test-password', 4);

process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_REGION ??= 'us-east-1';
process.env.S3_BUCKET ??= 'roomkit';
process.env.S3_ACCESS_KEY_ID ??= 'roomkit';
process.env.S3_SECRET_ACCESS_KEY ??= 'roomkit123';
process.env.S3_FORCE_PATH_STYLE ??= 'true';
