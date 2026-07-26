export interface SelectedTheme {
  id: string;
  name: string;
}

/**
 * Mutable per-process state established by the connection tools. Nothing is
 * read from env or config files: `login` supplies the server URL and admin
 * credentials (kept in memory only, for silent re-login when the 12h JWT
 * expires), `select_theme` sets the default theme for theme-scoped tools.
 */
export class SessionState {
  /** Server origin, e.g. http://localhost:3000 (no /api suffix). */
  apiUrl: string | null = null;
  adminId: string | null = null;
  adminPassword: string | null = null;
  token: string | null = null;
  selectedTheme: SelectedTheme | null = null;
}

/** Agent-facing failure that is not an HTTP error (preconditions, guidance). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function requireLogin(state: SessionState): void {
  if (!state.apiUrl) {
    throw new ToolError(
      'Not logged in. Call the `login` tool first — ask the user for the RoomKit server URL, admin id, and password.',
    );
  }
}

/** Resolves the effective theme id: explicit argument wins over selection. */
export function requireTheme(state: SessionState, themeId?: string): string {
  if (themeId) return themeId;
  if (state.selectedTheme) return state.selectedTheme.id;
  throw new ToolError(
    'No theme selected. Call `select_theme` first, or pass `themeId` explicitly.',
  );
}
