import type { Command } from 'commander';
import pc from 'picocolors';
import { getAsset, updateAsset } from '../core/ops/assets.js';
import { getFileUrl, uploadFile } from '../core/ops/uploads.js';
import { ToolError } from '../core/session.js';
import { resolveThemeId } from '../project/theme.js';
import { out } from '../ui/output.js';
import { emit, type GetContext } from './util.js';

const FILE_KINDS = new Set(['bgm', 'sfx', 'video', 'image', 'file']);

export function register(program: Command, ctx: GetContext): void {
  program
    .command('upload <file>')
    .description('파일을 테마 미디어 저장소에 업로드하고 저장 키를 돌려줍니다')
    .option('--content-type <type>', 'Content-Type (기본: 확장자로 추정)')
    .option('--set <assetRef>', '업로드 후 미디어 애셋(bgm/sfx/video/image/file)의 fileKey 로 설정')
    .action(async (file: string, opts: { contentType?: string; set?: string }) => {
      const c = ctx();
      const themeId = await resolveThemeId(c);
      const result = await uploadFile(c, themeId, file, opts.contentType);
      let asset: Awaited<ReturnType<typeof updateAsset>> | undefined;
      if (opts.set) {
        const target = await getAsset(c, themeId, opts.set);
        if (!FILE_KINDS.has(target.kind)) throw new ToolError(`"${target.name}" 은 ${target.kind} 애셋입니다. --set 은 bgm/sfx/video/image/file 에만 사용할 수 있습니다.`, 'wrong_kind');
        asset = await updateAsset(c, themeId, target.id, { data: { ...(target.data as Record<string, unknown>), fileKey: result.key } } as Parameters<typeof updateAsset>[3]);
      }
      emit(c, { ...result, asset: asset && { id: asset.id, name: asset.name } }, () => {
        out.ok(`업로드 완료: ${pc.bold(result.key)} (${(result.size / 1024).toFixed(1)} KB, ${result.contentType})`);
        if (asset) out.line(pc.dim(`${asset.kind} "${asset.name}" 의 fileKey 로 설정했습니다.`));
      });
    });

  const file = program.command('file').description('저장소 파일');
  file
    .command('url <key>')
    .description('저장 키의 임시 다운로드 URL (~10분)')
    .action(async (key: string) => {
      const c = ctx();
      const result = await getFileUrl(c, key);
      emit(c, result, () => out.line(result.url));
    });
}
