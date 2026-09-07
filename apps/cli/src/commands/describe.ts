import type { Command } from 'commander';
import pc from 'picocolors';
import { AssetKindSchema } from '@roomkit/shared';
import { assetKindDoc, commandsDoc } from '../core/schemas.js';
import { out } from '../ui/output.js';
import { emit, type GetContext } from './util.js';

export function register(program: Command, ctx: GetContext): void {
  const describe = program.command('describe').description('입력 형식 안내 (JSON Schema)');

  describe
    .command('commands')
    .description('이벤트 시퀀스(커맨드 배열)의 JSON Schema 와 참조 필드 안내')
    .action(async () => {
      const c = ctx();
      const doc = commandsDoc() as { notes: string[] };
      emit(c, doc, () => {
        out.line(pc.bold('시퀀스 커맨드 안내'));
        for (const n of doc.notes) out.line(`- ${n}`);
        out.line();
        out.line(pc.dim('전체 JSON Schema: rk describe commands --json'));
      });
    });

  describe
    .command('asset <kind>')
    .description(`애셋 종류별 data 형식과 안내 (${AssetKindSchema.options.join('|')})`)
    .action(async (kind: string) => {
      const c = ctx();
      const doc = assetKindDoc(AssetKindSchema.parse(kind)) as { kind: string; notes: string[]; dataJsonSchema: unknown };
      emit(c, doc, () => {
        out.line(pc.bold(`${doc.kind} 애셋`));
        for (const n of doc.notes) out.line(`- ${n}`);
        out.line();
        out.line(pc.dim('data JSON Schema:'));
        out.line(JSON.stringify(doc.dataJsonSchema, null, 2));
      });
    });
}
