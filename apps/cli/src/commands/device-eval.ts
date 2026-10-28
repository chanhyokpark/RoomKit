import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type { Command } from "commander";
import { DeviceEvalInputSchema, type DeviceEvalResult } from "@roomkit/shared";
import { evaluateDevice, windowDevice } from "../core/ops/devices.js";
import { ToolError } from "../core/session.js";
import { parseInteger } from "../ui/json-input.js";
import { out } from "../ui/output.js";
import { emit, type GetContext } from "./util.js";

export type ScreenshotFormat = "png" | "jpeg";

/**
 * Validate a screenshot output path before anything runs: PNG/JPEG only,
 * refuse to clobber an existing file unless `overwrite`, create the folder.
 */
export function prepareScreenshotPath(
  value: string,
  overwrite: boolean,
): { path: string; format: ScreenshotFormat } {
  const path = resolve(value);
  const extension = extname(path).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(extension))
    throw new ToolError(
      "Screenshot output requires a .png, .jpg or .jpeg path.",
      "usage",
    );
  if (!overwrite && existsSync(path))
    throw new ToolError(
      `Screenshot file already exists: ${path} (pass --overwrite to replace it)`,
      "usage",
    );
  mkdirSync(dirname(path), { recursive: true });
  return { path, format: extension === ".png" ? "png" : "jpeg" };
}

export function saveEvaluationScreenshot(
  path: string,
  screenshot: NonNullable<DeviceEvalResult["screenshot"]>,
  overwrite = false,
) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(
    screenshot.image,
  );
  if (!match)
    throw new ToolError(
      "Player returned an invalid screenshot.",
      "invalid_result",
    );
  const expected = extname(path).toLowerCase() === ".png" ? "png" : "jpeg";
  if (match[1] !== expected)
    throw new ToolError(
      "Screenshot format does not match the requested file extension.",
      "invalid_result",
    );
  writeFileSync(path, Buffer.from(match[2]!, "base64"), {
    flag: overwrite ? "w" : "wx",
  });
  return {
    path,
    mimeType: `image/${match[1]}`,
    width: screenshot.width,
    height: screenshot.height,
    capturedAt: screenshot.capturedAt,
  };
}

/**
 * Shared tail of eval/screenshot: fail on a script/window error, then on a
 * capture error (keeping the successful value in details), then save.
 */
export function finishWithScreenshot<V>(
  response: {
    requestId: string;
    result:
      | { ok: true; value: V }
      | { ok: false; error: { code: string; message: string } };
    screenshot?: DeviceEvalResult["screenshot"];
    screenshotError?: { code: string; message: string };
  },
  target: { path: string; overwrite: boolean } | undefined,
): {
  requestId: string;
  ok: true;
  value: V;
  screenshot?: ReturnType<typeof saveEvaluationScreenshot>;
} {
  const details = {
    requestId: response.requestId,
    result: response.result,
    screenshotError: response.screenshotError,
  };
  const outcome = response.result;
  if (!outcome.ok)
    throw new ToolError(outcome.error.message, outcome.error.code, details);
  if (response.screenshotError)
    throw new ToolError(
      response.screenshotError.message,
      response.screenshotError.code,
      details,
    );
  let screenshot: ReturnType<typeof saveEvaluationScreenshot> | undefined;
  if (target) {
    if (!response.screenshot)
      throw new ToolError(
        "Player did not return a screenshot.",
        "capture_failed",
        details,
      );
    try {
      screenshot = saveEvaluationScreenshot(
        target.path,
        response.screenshot,
        target.overwrite,
      );
    } catch (error) {
      throw new ToolError(
        `Request completed but saving the screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
        "capture_save_failed",
        details,
      );
    }
  }
  return {
    requestId: response.requestId,
    ok: true,
    value: outcome.value,
    ...(screenshot ? { screenshot } : {}),
  };
}

export function registerDeviceEval(device: Command, ctx: GetContext): void {
  device
    .command("eval <device>")
    .description(
      "테스트 Player 의 웹사이트 iframe 안에서 비동기 JS 실행 (return 으로 JSON 반환)",
    )
    .requiredOption(
      "--session <id>",
      "실행 중이거나 시작 전인 테스트 세션 UUID",
    )
    .option("--script <js>", "실행할 async 함수 본문 (--file 과 택일)")
    .option("--file <path>", "JS 파일 경로, 또는 - 로 표준 입력")
    .option("--timeout <ms>", "실행 제한 시간 (100–60000ms)", "10000")
    .option(
      "--screenshot <path>",
      "실행 후 새 네이티브 캡처를 PNG/JPEG 로 저장",
    )
    .option("--overwrite", "--screenshot 대상 파일이 있으면 덮어씀", false)
    .option(
      "--focus",
      "실행 전에 Player 창을 앞으로 가져옴 (표시·최소화 해제·포커스·렌더링 대기)",
      false,
    )
    .action(
      async (
        deviceRef: string,
        opts: {
          session: string;
          script?: string;
          file?: string;
          timeout: string;
          screenshot?: string;
          overwrite: boolean;
          focus: boolean;
        },
      ) => {
        if ((opts.script === undefined) === (opts.file === undefined))
          throw new ToolError(
            "Pass exactly one of --script or --file.",
            "usage",
          );
        let code: string;
        try {
          code =
            opts.file === undefined
              ? opts.script!
              : readFileSync(opts.file === "-" ? 0 : opts.file, "utf8");
        } catch {
          throw new ToolError(`Cannot read script: ${opts.file}`, "usage");
        }
        const timeoutMs = parseInteger(opts.timeout, "--timeout");
        const target =
          opts.screenshot === undefined
            ? undefined
            : prepareScreenshotPath(opts.screenshot, opts.overwrite);
        const input = DeviceEvalInputSchema.parse({
          code,
          timeoutMs,
          screenshot: !!target,
          screenshotFormat: target?.format ?? "png",
        });
        const c = ctx();
        if (opts.focus) await focusBeforehand(c, opts.session, deviceRef, timeoutMs);
        const response = await evaluateDevice(
          c,
          opts.session,
          deviceRef,
          input,
        );
        const result = finishWithScreenshot(
          response,
          target ? { path: target.path, overwrite: opts.overwrite } : undefined,
        );
        emit(c, result, () => {
          out.json(result.value);
          if (result.screenshot) out.ok(`스크린샷: ${result.screenshot.path}`);
        });
      },
    );
}

/** `--focus`: a separate window RPC first, so the eval itself paints visibly. */
export async function focusBeforehand(
  c: ReturnType<GetContext>,
  sessionId: string,
  deviceRef: string,
  timeoutMs: number,
): Promise<void> {
  const response = await windowDevice(c, sessionId, deviceRef, {
    focus: true,
    timeoutMs: Math.min(Math.max(timeoutMs, 100), 60_000),
  });
  if (!response.result.ok)
    throw new ToolError(
      `Could not bring the Player window to the front: ${response.result.error.message}`,
      response.result.error.code,
      { requestId: response.requestId, result: response.result },
    );
}
