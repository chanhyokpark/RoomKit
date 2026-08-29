import type { ZodType } from 'zod';
import { CREDENTIALS_PATH, loadCredentials, saveCredentials } from './creds.js';
import { requireLogin, SessionState, ToolError } from './session.js';

/** Error thrown for non-2xx API responses. `body` is the parsed NestJS error payload. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(extractMessage(body) ?? `Request failed (${status})`);
    this.name = 'ApiError';
  }
}

function extractMessage(body: unknown): string | null {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
      return message.join(', ');
    }
  }
  return null;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export interface ApiOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON payload, or a FormData for multipart uploads (sent as-is). */
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** When given, the response JSON is validated/coerced through this schema. */
  schema?: ZodType<T>;
}

export class ApiClient {
  constructor(private readonly state: SessionState) {}

  /**
   * Verifies the credentials against the server before committing them to
   * state, so a failed login never clobbers a working connection. Successful
   * credentials are persisted so future MCP processes auto-login.
   */
  async login(url: string, id: string, password: string): Promise<void> {
    const base = url.replace(/\/+$/, '').replace(/\/api$/, '');
    const { accessToken } = await this.rawLogin(base, id, password);
    this.state.apiUrl = base;
    this.state.adminId = id;
    this.state.adminPassword = password;
    this.state.token = accessToken;
    saveCredentials({ url: base, id, password });
  }

  /**
   * Makes the client usable without an explicit `login` call: when the
   * process has no session yet, silently logs in with the credentials saved
   * by a previous login. Throws agent-facing guidance when that is impossible.
   */
  async ensureLogin(): Promise<void> {
    if (this.state.apiUrl) return;
    const saved = loadCredentials();
    if (!saved) requireLogin(this.state);
    try {
      await this.login(saved!.url, saved!.id, saved!.password);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ToolError(
        `Auto-login with the saved credentials (${CREDENTIALS_PATH}) failed: ${detail}. ` +
          'Ask the user for the server URL, admin id, and password, then call `login`.',
      );
    }
  }

  private async rawLogin(
    base: string,
    id: string,
    password: string,
  ): Promise<{ accessToken: string }> {
    let res: Response;
    try {
      res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password }),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ToolError(
        `Could not reach the RoomKit server at ${base}: ${detail}. Check the URL (and that the server is running).`,
      );
    }
    if (!res.ok) throw new ApiError(res.status, await parseJsonSafe(res));
    const json = (await parseJsonSafe(res)) as { accessToken?: unknown } | null;
    if (typeof json?.accessToken !== 'string') {
      throw new ToolError('Login response did not contain an accessToken.');
    }
    return { accessToken: json.accessToken };
  }

  async api<T = unknown>(path: string, opts: ApiOptions<T> = {}): Promise<T> {
    await this.ensureLogin();
    let res = await this.request(path, opts);

    // The admin JWT expires after 12h — re-login once with the stored
    // credentials, then surface a clear error if that also fails.
    if (res.status === 401) {
      try {
        const { accessToken } = await this.rawLogin(
          this.state.apiUrl!,
          this.state.adminId!,
          this.state.adminPassword!,
        );
        this.state.token = accessToken;
      } catch {
        throw new ToolError(
          'The session expired and automatic re-login failed. Ask the user for valid credentials and call `login` again.',
        );
      }
      res = await this.request(path, opts);
    }

    if (!res.ok) throw new ApiError(res.status, await parseJsonSafe(res));
    if (res.status === 204) return undefined as T;
    const json = await parseJsonSafe(res);
    return opts.schema ? opts.schema.parse(json) : (json as T);
  }

  private request(path: string, opts: ApiOptions<unknown>): Promise<Response> {
    const url = new URL(`${this.state.apiUrl}/api${path}`);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    // FormData is passed through so fetch sets the multipart boundary itself.
    const isForm = opts.body instanceof FormData;
    const headers: Record<string, string> = {};
    if (opts.body !== undefined && !isForm) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.state.token) headers['Authorization'] = `Bearer ${this.state.token}`;
    return fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: isForm
        ? (opts.body as FormData)
        : opts.body !== undefined
          ? JSON.stringify(opts.body)
          : undefined,
    });
  }
}
