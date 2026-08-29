import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const SavedCredentialsSchema = z.object({
  url: z.string().min(1),
  id: z.string().min(1),
  password: z.string().min(1),
});
export type SavedCredentials = z.infer<typeof SavedCredentialsSchema>;

/**
 * Last successful login, persisted across MCP restarts so tools keep working
 * without asking the user again. Plaintext by design (dev-tool trade-off,
 * like ~/.netrc); the file is chmod 600.
 */
export const CREDENTIALS_PATH = join(homedir(), '.roomkit', 'mcp-credentials.json');

export function loadCredentials(): SavedCredentials | null {
  try {
    return SavedCredentialsSchema.parse(
      JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')),
    );
  } catch {
    return null;
  }
}

/** Persistence failure is non-fatal — the in-memory session still works. */
export function saveCredentials(creds: SavedCredentials): boolean {
  try {
    mkdirSync(dirname(CREDENTIALS_PATH), { recursive: true });
    writeFileSync(CREDENTIALS_PATH, `${JSON.stringify(creds, null, 2)}\n`, {
      mode: 0o600,
    });
    return true;
  } catch (err) {
    console.error(`Could not save credentials to ${CREDENTIALS_PATH}:`, err);
    return false;
  }
}
