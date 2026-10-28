import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type { Command } from "commander";
import { DeviceEvalInputSchema, type DeviceEvalResult } from "@roomkit/shared";
import { evaluateDevice } from "../core/ops/devices.js";
import { ToolError } from "../core/session.js";
import { parseInteger } from "../ui/json-input.js";
import { out } from "../ui/output.js";
import { emit, type GetContext } from "./util.js";

export function saveEvaluationScreenshot(
  path: string,
  screenshot: NonNullable<DeviceEvalResult["screenshot"]>,
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
  writeFileSync(path, Buffer.from(match[2]!, "base64"), { flag: "wx" });
  return {
    path,
    mimeType: `image/${match[1]}`,
    width: screenshot.width,
    height: screenshot.height,
    capturedAt: screenshot.capturedAt,
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
      "실행 후 새 네이티브 캡처를 PNG/JPEG 로 저장 (기존 파일 덮어쓰기 안 함)",
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
        const path =
          opts.screenshot === undefined ? undefined : resolve(opts.screenshot);
        const extension = path ? extname(path).toLowerCase() : ".png";
        if (path && ![".png", ".jpg", ".jpeg"].includes(extension))
          throw new ToolError(
            "--screenshot requires a .png, .jpg or .jpeg path.",
            "usage",
          );
        const input = DeviceEvalInputSchema.parse({
          code,
          timeoutMs: parseInteger(opts.timeout, "--timeout"),
          screenshot: !!path,
          screenshotFormat: extension === ".png" ? "png" : "jpeg",
        });
        if (path) {
          if (existsSync(path))
            throw new ToolError(
              `Screenshot file already exists: ${path}`,
              "usage",
            );
          mkdirSync(dirname(path), { recursive: true });
        }
        const c = ctx();
        const response = await evaluateDevice(
          c,
          opts.session,
          deviceRef,
          input,
        );
        const details = {
          requestId: response.requestId,
          result: response.result,
          screenshotError: response.screenshotError,
        };
        if (!response.result.ok)
          throw new ToolError(
            response.result.error.message,
            response.result.error.code,
            details,
          );
        if (response.screenshotError)
          throw new ToolError(
            response.screenshotError.message,
            response.screenshotError.code,
            details,
          );
        let screenshot: ReturnType<typeof saveEvaluationScreenshot> | undefined;
        if (path) {
          if (!response.screenshot)
            throw new ToolError(
              "Player did not return a screenshot.",
              "capture_failed",
              details,
            );
          try {
            screenshot = saveEvaluationScreenshot(path, response.screenshot);
          } catch (error) {
            throw new ToolError(
              `Script completed but saving the screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
              "capture_save_failed",
              details,
            );
          }
        }
        const result = {
          requestId: response.requestId,
          ...response.result,
          ...(screenshot ? { screenshot } : {}),
        };
        emit(c, result, () => {
          out.json(result.value);
          if (screenshot) out.ok(`스크린샷: ${screenshot.path}`);
        });
      },
    );
}
