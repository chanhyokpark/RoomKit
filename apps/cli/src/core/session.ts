/**
 * Mutable per-process connection state. `login` supplies the server URL and
 * admin credentials (used for silent re-login when the JWT expires) and, when
 * asked to, persists them to ~/.roomkit/mcp-credentials.json so later runs
 * auto-login — see creds.ts. The current theme is NOT process state: it comes
 * from roomkit.json / --theme (see project/theme.ts).
 */
export class SessionState {
  /** Server origin, e.g. http://localhost:3000 (no /api suffix). */
  apiUrl: string | null = null;
  adminId: string | null = null;
  adminPassword: string | null = null;
  token: string | null = null;
}

/** Failure that is not an HTTP error (preconditions, guidance). */
export class ToolError extends Error {
  constructor(
    message: string,
    /** Stable machine-readable code for --json output and exit codes. */
    readonly code: string = 'error',
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export function requireLogin(state: SessionState): void {
  if (!state.apiUrl) {
    throw new ToolError(
      'Not logged in and no saved credentials were found. Run `rk login` with the RoomKit server URL, admin id, and password.',
      'not_logged_in',
    );
  }
}
