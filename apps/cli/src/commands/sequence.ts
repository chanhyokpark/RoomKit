import type { Command } from 'commander';
import pc from 'picocolors';
import {
  editEventSequence,
  getEventSequence,
  LooseSequenceSchema,
  SequenceOpsSchema,
  setEventSequence,
  validateSequence,
  type SequenceOp,
} from '../core/ops/sequences.js';
import { SequenceOpSchema, type LooseEntry } from '../core/sequence-ops.js';
import { ToolError } from '../core/session.js';
import { resolveThemeId } from '../project/theme.js';
import { collect, readJsonArg } from '../ui/json-input.js';
import { kv, out } from '../ui/output.js';
import { emit, type GetContext } from './util.js';

function printWarnings(warnings: string[]): void {
  for (const w of warnings) out.warn(w);
  if (warnings.length) out.line(pc.dim('경고는 런타임에서 조용히 건너뛰는 항목입니다. 해결 후 다시 확인해 주세요.'));
}

function printOutline(outline: string[]): void {
  if (!outline.length) return out.line(pc.dim('(빈 시퀀스)'));
  for (const line of outline) out.line(line);
}

export function register(program: Command, ctx: GetContext): void {
  const seq = program.command('sequence').description('이벤트 시퀀스 (커맨드 배열) 조회·편집. 형식: rk describe commands');

  seq
    .command('get <event>')
    .description('이벤트의 트리거 설정과 시퀀스. event = uuid | 키 | 이름')
    .option('--outline', '항목당 한 줄 요약 (편집 대상 찾기에 적합)')
    .action(async (event: string, opts: { outline?: boolean }) => {
      const c = ctx();
      const result = await getEventSequence(c, await resolveThemeId(c), event, opts.outline ? 'outline' : 'full');
      emit(c, result, () => {
        out.line(kv([['이벤트', `${result.name}${result.key ? ` (key=${result.key})` : ''}`], ['ID', result.eventId], ['트리거', JSON.stringify(result.trigger)], ['항목 수', result.entryCount]]));
        out.line();
        if ('outline' in result) printOutline(result.outline);
        else {
          out.line(JSON.stringify(result.sequence, null, 2));
          const refs = Object.entries(result.refs);
          if (refs.length) {
            out.line();
            out.line(pc.dim('참조:'));
            for (const [id, label] of refs) out.line(pc.dim(`  ${id} → ${label}`));
          }
        }
      });
    });

  seq
    .command('set <event>')
    .description('시퀀스 전체 교체 (트리거 설정은 유지). id 생략 가능, 참조는 uuid/키/코드/이름')
    .requiredOption('--sequence <json>', 'JSON 배열, @파일, 또는 - (stdin)')
    .action(async (event: string, opts: { sequence: string }) => {
      const c = ctx();
      const sequence = readJsonArg(opts.sequence, '--sequence', LooseSequenceSchema) as LooseEntry[];
      const result = await setEventSequence(c, await resolveThemeId(c), event, sequence);
      emit(c, result, () => {
        out.ok(`시퀀스 저장 (${result.entryCount}개 항목)`);
        printOutline(result.outline);
        printWarnings(result.warnings);
      });
    });

  seq
    .command('edit <event>')
    .description('부분 편집: insert/replace/update/remove/move 연산을 순서대로 적용 (실패 시 저장 안 함)')
    .option('--ops <json>', '연산 배열: JSON, @파일, - (stdin)')
    .option('--op <json>', '연산 하나 (반복 가능)', collect)
    .option('--return-sequence', '저장된 전체 시퀀스도 출력')
    .action(async (event: string, opts: { ops?: string; op?: string[]; returnSequence?: boolean }) => {
      const c = ctx();
      let ops: SequenceOp[] = [];
      if (opts.ops) ops = readJsonArg(opts.ops, '--ops', SequenceOpsSchema);
      for (const raw of opts.op ?? []) ops.push(readJsonArg(raw, '--op', SequenceOpSchema));
      if (!ops.length) throw new ToolError('--ops 또는 --op 로 연산을 지정해 주세요.', 'usage');
      const result = await editEventSequence(c, await resolveThemeId(c), event, ops, opts.returnSequence);
      emit(c, result, () => {
        out.ok(`${result.applied.length}개 연산 적용, ${result.entryCount}개 항목`);
        for (const a of result.applied) out.line(pc.dim(`  ${a.op} → ${a.where}[${a.index}] id=${a.id}`));
        printOutline(result.outline);
        printWarnings(result.warnings);
      });
    });

  seq
    .command('validate')
    .description('저장 없이 시퀀스 검증 (참조 해석, 스키마, 경고)')
    .requiredOption('--sequence <json>', 'JSON 배열, @파일, 또는 - (stdin)')
    .action(async (opts: { sequence: string }) => {
      const c = ctx();
      const sequence = readJsonArg(opts.sequence, '--sequence', LooseSequenceSchema) as LooseEntry[];
      const result = await validateSequence(c, await resolveThemeId(c), sequence);
      emit(c, result, () => {
        out.ok(`유효한 시퀀스 (${result.entryCount}개 항목)`);
        printWarnings(result.warnings);
      });
    });
}
