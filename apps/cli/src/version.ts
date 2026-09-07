/** CLI version: injected by tsup at build time; a dev marker under tsx. */
export const CLI_VERSION: string = typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : '0.0.0-dev';

export const REPO = 'chanhyokpark/RoomKit';
export const REPO_URL = `https://github.com/${REPO}`;
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/refs/heads/master/`;

/** The exact command users run to install or upgrade the CLI. */
export function installCommand(ref?: string): string {
  const spec = ref ? `github:${REPO}#${ref}&path:apps/cli` : `github:${REPO}#path:apps/cli`;
  return `pnpm add -g --allow-build=@roomkit/cli "${spec}"`;
}
