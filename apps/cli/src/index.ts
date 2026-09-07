import { CommanderError } from 'commander';
import pc from 'picocolors';
import { createProgram } from './program.js';
import { describeError, errorToJson, exitCodeFor, out } from './ui/output.js';

async function main(): Promise<number> {
  const handle = createProgram();
  let code = 0;
  let json = process.argv.includes('--json');
  try {
    await handle.program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help / --version exit through here with code 0; usage errors were already printed.
      return err.exitCode;
    }
    try {
      json = handle.ctx().json;
    } catch {
      // context never initialised (pre-action failure)
    }
    if (json) process.stderr.write(`${JSON.stringify(errorToJson(err))}\n`);
    else out.fail(describeError(err));
    code = exitCodeFor(err);
  } finally {
    await printUpdateNotice(handle, json);
  }
  return code;
}

async function printUpdateNotice(handle: ReturnType<typeof createProgram>, json: boolean): Promise<void> {
  if (json || !process.stderr.isTTY) return;
  const info = await Promise.race([handle.update(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
  if (info?.outdated) {
    process.stderr.write(
      `\n${pc.yellow('!')} 새 버전 v${info.latest} 이 있습니다 (현재 v${info.current}). 업데이트: ${pc.bold('rk upgrade')}\n`,
    );
  }
}

main().then(
  (code) => {
    // Let stdout flush before exiting (pipes).
    process.exitCode = code;
    setImmediate(() => process.exit(code));
  },
  (err) => {
    out.fail(describeError(err));
    process.exit(1);
  },
);
