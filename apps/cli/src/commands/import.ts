import type { Command } from 'commander';
import pc from 'picocolors';
import { BulkUploadKindSchema } from '@roomkit/shared';
import { importMedia } from '../core/ops/archive.js';
import { resolveThemeId } from '../project/theme.js';
import { out, table } from '../ui/output.js';
import { spinner } from '../ui/prompt.js';
import { emit, type GetContext } from './util.js';

export function register(program: Command, ctx: GetContext): void {
  const imp = program.command('import').description('일괄 가져오기');

  imp
    .command('media <kind> <zip>')
    .description(`zip 안의 파일로 미디어 애셋 일괄 생성 (${BulkUploadKindSchema.options.join('|')})`)
    .action(async (kind: string, zip: string) => {
      const c = ctx();
      const themeId = await resolveThemeId(c);
      const s = spinner(c, '업로드 중');
      let result;
      try {
        result = await importMedia(c, themeId, BulkUploadKindSchema.parse(kind), zip);
        s.stop(`완료: ${result.created.length}개 생성, ${result.skipped.length}개 건너뜀`);
      } catch (err) {
        s.fail('실패');
        throw err;
      }
      emit(c, result, () => {
        if (result.created.length) out.line(table(['이름', 'ID', '파일'], result.created.map((a) => [a.name, a.assetId, a.files.join(', ')])));
        for (const sk of result.skipped) out.warn(`${sk.file}: ${sk.reason}`);
        if (!result.created.length) out.info(pc.dim('생성된 애셋이 없습니다.'));
      });
    });
}
