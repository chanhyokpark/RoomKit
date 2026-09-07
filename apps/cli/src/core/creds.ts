import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const SavedCredentialsSchema = z.object({
  url: z.string().min(1),
  id: z.string().min(1),
  password: z.string().min(1),
});
export type SavedCredentials = z.infer<typeof SavedCredentialsSchema>;

/** Per-user RoomKit state directory (credentials, update-check cache). */
export const ROOMKIT_HOME = join(homedir(), '.roomkit');

/**
 * Last successful login, shared with the (deprecated) MCP server so both
 * tools use one login. Plaintext by design (dev-tool trade-off, like
 * ~/.netrc); the file is chmod 600.
 */
export const CREDENTIALS_PATH = join(ROOMKIT_HOME, 'mcp-credentials.json');

export function loadCredentials(): SavedCredentials | null {
  try {
    return SavedCredentialsSchema.parse(JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')));
  } catch {
    return null;
  }
}

/** Persistence failure is non-fatal — the in-memory session still works. */
export function saveCredentials(creds: SavedCredentials): boolean {
  try {
    mkdirSync(dirname(CREDENTIALS_PATH), { recursive: true });
    writeFileSync(CREDENTIALS_PATH, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
    return true;
  } catch (err) {
    console.error(`Could not save credentials to ${CREDENTIALS_PATH}:`, err);
    return false;
  }
}

/** Returns true when a file was removed. */
export function deleteCredentials(): boolean {
  try {
    rmSync(CREDENTIALS_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Credentials given for this run only (flags or ROOMKIT_URL/ID/PASSWORD env),
 * for CI and scripts. All three must be present to count.
 */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): SavedCredentials | null {
  const url = env.ROOMKIT_URL;
  const id = env.ROOMKIT_ID;
  const password = env.ROOMKIT_PASSWORD;
  return url && id && password ? { url, id, password } : null;
}
