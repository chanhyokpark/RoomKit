import { credentialsFromEnv } from './core/creds.js';
import { ApiClient } from './core/http.js';
import type { OpsContext } from './core/context.js';
import { SessionState } from './core/session.js';
import { VirtualDeviceManager } from './core/virtual-device.js';
import { findProject, type ProjectHandle } from './project/config.js';

export interface GlobalFlags {
  json: boolean;
  yes: boolean;
  theme?: string;
  project?: string;
  url?: string;
  id?: string;
  password?: string;
  updateCheck: boolean;
}

/**
 * Everything a command needs: the ops context (API + devices), parsed global
 * flags, the project (lazy), and the interactivity/output policy.
 */
export class CliContext implements OpsContext {
  readonly state = new SessionState();
  readonly api = new ApiClient(this.state);
  readonly devices = new VirtualDeviceManager(this.state);
  /** Non-fatal notices collected during a command (JSON: `warnings`; human: stderr). */
  readonly warnings: string[] = [];
  private projectCache: ProjectHandle | null | undefined;

  constructor(readonly flags: GlobalFlags) {
    // Complete flag credentials override the saved file for this run; partial
    // ones only matter to `rk login` (which prompts for the rest).
    const flagCreds =
      flags.url && flags.id && flags.password ? { url: flags.url, id: flags.id, password: flags.password } : null;
    this.api.override = flagCreds ?? credentialsFromEnv();
  }

  get json(): boolean {
    return this.flags.json;
  }

  get yes(): boolean {
    return this.flags.yes;
  }

  /** Prompts are allowed only on a real terminal without --json/--yes/CI. */
  interactive(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !this.flags.json && !this.flags.yes && !process.env.CI;
  }

  /** Nearest roomkit.json (or --project). Cached; null when none. */
  get project(): ProjectHandle | null {
    if (this.projectCache === undefined) this.projectCache = findProject(this.flags.project);
    return this.projectCache;
  }

  /** Re-read after writes. */
  reloadProject(): ProjectHandle | null {
    this.projectCache = undefined;
    return this.project;
  }

  warn(message: string): void {
    this.warnings.push(message);
  }
}
