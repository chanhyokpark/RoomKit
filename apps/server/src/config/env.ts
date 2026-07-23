import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  ADMIN_ID: z.string().min(1),
  ADMIN_PASSWORD_HASH: z.string().min(1),
  S3_ENDPOINT: z.url(),
  /**
   * S3 endpoint as reachable by browsers/devices, used only for presigned
   * URLs. Needed when the server runs in Docker and reaches MinIO via the
   * compose network (`http://minio:9000`) while clients reach it via the
   * published host port (`http://localhost:9000`). Defaults to S3_ENDPOINT.
   */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Externally reachable server origin, used to mint absolute URLs for
   * hosted-website navigation. Defaults to http://localhost:{PORT}.
   */
  PUBLIC_SERVER_URL: z.url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${JSON.stringify(z.treeifyError(result.error), null, 2)}`,
    );
  }
  return result.data;
}
