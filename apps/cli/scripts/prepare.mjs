// Runs on `pnpm install` (git installs build the CLI here). Skipped when the
// sources are absent — the Dockerfiles install with manifests only — so the
// guard works on Windows too, unlike a `[ -f ... ] ||` shell test.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(root, 'tsup.config.ts'))) process.exit(0);

const result = spawnSync('pnpm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
