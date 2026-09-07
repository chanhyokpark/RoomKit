import type { Command } from 'commander';
import pc from 'picocolors';
import { AssetKeySchema, AssetKindSchema, SystemTriggerSchema, type Asset, type AssetKind } from '@roomkit/shared';
import type { CliContext } from '../context.js';
import { createAsset, deleteAsset, getAsset, listAssets, summarizeAsset, updateAsset, type LooseCreateAsset } from '../core/ops/assets.js';
import { uploadFile } from '../core/ops/uploads.js';
import { ToolError } from '../core/session.js';
import { resolveThemeId } from '../project/theme.js';
import { collect, readJsonArg } from '../ui/json-input.js';
import { kv, out, shortId, table } from '../ui/output.js';
import { confirm, select, text } from '../ui/prompt.js';
import { emit, type GetContext } from './util.js';

const KIND_LABELS: Record<AssetKind, string> = {
  device: '장치 (device)',
  website: '웹사이트 (website)',
  phase: '페이즈 (phase)',
  event: '이벤트 (event)',
  player: '플레이어 (player: 스피커+화면 조합)',
  bgm: 'BGM (bgm)',
  sfx: '효과음 (sfx)',
  video: '비디오 (video)',
  dialogue: '대사 (dialogue)',
  hint: '힌트 (hint)',
  message: '메시지 (message)',
  image: '이미지 (image)',
  file: '파일 (file)',
};

const KEY_HINT = '테마 안에서 유일한 슬러그 (예: door-screen). 이후 uuid 대신 이 키로 참조합니다.';

function validateKey(value: string): string | undefined {
  if (!value) return undefined;
  return AssetKeySchema.safeParse(value).success ? undefined : '영문/숫자로 시작, 1–64자, [A-Za-z0-9_.-] 만 허용됩니다.';
}

/** Defaults that make a kind creatable with no extra input (placeholders where the schema allows). */
function defaultData(kind: AssetKind, name: string): Record<string, unknown> | null {
  switch (kind) {
    case 'device':
      return { displayName: name, isHintDevice: false, hintCodeCss: '' };
    case 'event':
      return { phaseId: null, triggerKind: 'manual', triggerName: null, manualTriggerable: true, allowReentry: false, once: false, sequence: [] };
    case 'bgm':
    case 'sfx':
    case 'video':
    case 'image':
    case 'file':
      return { fileKey: null };
    case 'message':
      return { displayName: name, fields: [] };
    case 'dialogue':
      return { keepSubtitleAfterEnd: false, lines: [] };
    case 'phase':
      return { order: 0 };
    case 'website':
    case 'player':
    case 'hint':
      return null; // required fields the wizard or --data must supply
  }
}

interface CreateFlags {
  kind?: string;
  name?: string;
  key?: string;
  code?: string;
  description?: string;
  tag?: string[];
  data?: string;
  file?: string;
  websiteUrl?: string;
}

/** Interactive kind-specific questions; returns extra `data` fields. */
async function wizardData(ctx: CliContext, themeId: string, kind: AssetKind, name: string): Promise<Record<string, unknown>> {
  const pickAsset = async (message: string, k: AssetKind, allowNone: boolean) => {
    const assets = await listAssets(ctx, themeId, { kind: k });
    const options = [
      ...assets.map((a) => ({ value: a.id, label: a.name, hint: a.key ?? shortId(a.id) })),
      ...(allowNone ? [{ value: '', label: '(없음)' }] : []),
    ];
    if (!options.length) throw new ToolError(`${KIND_LABELS[k]} 애셋이 없습니다. 먼저 만들어 주세요.`, 'missing_input');
    const v = await select(ctx, ['--data'], message, options);
    return v || null;
  };
  switch (kind) {
    case 'device': {
      const displayName = await text(ctx, ['--data'], { message: '표시 이름', initialValue: name });
      const isHintDevice = await confirm(ctx, '힌트 코드 입력 UI를 실행하는 장치인가요?', false);
      return { displayName, isHintDevice, hintCodeCss: '' };
    }
    case 'website': {
      const url = await text(ctx, ['--website-url'], {
        message: '외부 URL (배포 전 임시값이어도 됩니다; rk deploy 가 호스팅 모드로 바꿉니다)',
        initialValue: 'http://localhost:5173',
      });
      return { mode: 'external', url };
    }
    case 'phase': {
      const phases = await listAssets(ctx, themeId, { kind: 'phase' });
      const next = phases.reduce((m, p) => (p.kind === 'phase' ? Math.max(m, p.data.order + 1) : m), 1);
      const order = await text(ctx, ['--data'], { message: '순서 (숫자, 오름차순 진행)', initialValue: String(next) });
      return { order: Number(order) };
    }
    case 'event': {
      const triggerKind = await select(ctx, ['--data'], '트리거 종류', [
        { value: 'device', label: 'device — 장치가 보고하는 이벤트 이름' },
        { value: 'manual', label: 'manual — 운영자가 직접 실행' },
        { value: 'system', label: 'system — 세션/페이즈 시스템 훅' },
      ]);
      let triggerName: string | null = null;
      if (triggerKind === 'device') triggerName = await text(ctx, ['--data'], { message: '트리거 이름 (예: button:press)' });
      if (triggerKind === 'system') {
        triggerName = await select(ctx, ['--data'], '시스템 트리거', SystemTriggerSchema.options.map((o) => ({ value: o, label: o })));
      }
      const phaseId = await pickAsset('페이즈 (없음 = 모든 페이즈에서 유효한 공통 이벤트)', 'phase', true);
      const manualTriggerable = triggerKind === 'manual' ? true : await confirm(ctx, '운영자가 수동으로도 실행할 수 있게 할까요?', true);
      return { phaseId, triggerKind, triggerName, manualTriggerable, allowReentry: false, once: false, sequence: [] };
    }
    case 'player': {
      const speakerDeviceId = await pickAsset('스피커 장치 (오디오 재생)', 'device', false);
      const screenDeviceId = await pickAsset('화면 장치 (자막/비디오 표시)', 'device', false);
      return { speakerDeviceId, screenDeviceId, subtitleCss: '', dialogueDuckPercent: null, sfxDuckPercent: null };
    }
    case 'bgm':
    case 'sfx':
    case 'video':
    case 'image':
    case 'file': {
      const file = await text(ctx, ['--file'], { message: '업로드할 파일 경로 (비우면 파일 없는 플레이스홀더)', placeholder: '/path/to/file' });
      if (!file.trim()) return { fileKey: null };
      const uploaded = await uploadFile(ctx, themeId, file.trim());
      return { fileKey: uploaded.key };
    }
    case 'hint': {
      const step = await text(ctx, ['--data'], { message: '첫 번째 힌트 단계 내용 (HTML 허용)' });
      return { steps: [{ textHtml: step, imageKey: null }], answer: null, params: {} };
    }
    case 'message': {
      const displayName = await text(ctx, ['--data'], { message: '표시 이름', initialValue: name });
      return { displayName, fields: [] };
    }
    case 'dialogue':
      return { keepSubtitleAfterEnd: false, lines: [], params: {} };
  }
}

export async function buildCreatePayload(ctx: CliContext, themeId: string, flags: CreateFlags): Promise<LooseCreateAsset> {
  const kind = (flags.kind
    ? AssetKindSchema.parse(flags.kind)
    : await select(ctx, ['--kind'], '애셋 종류', AssetKindSchema.options.map((k) => ({ value: k, label: KIND_LABELS[k] })))) as AssetKind;
  const name = flags.name ?? (await text(ctx, ['--name'], { message: '이름', validate: (v) => (v.trim() ? undefined : '이름을 입력해 주세요.') }));
  let key = flags.key;
  if (key === undefined && ctx.interactive()) {
    key = await text(ctx, ['--key'], { message: `키 (선택) — ${KEY_HINT}`, placeholder: 'door-screen', validate: validateKey });
  }
  let code = flags.code;
  if (code === undefined && (kind === 'device' || kind === 'hint') && ctx.interactive()) {
    code = await text(ctx, ['--code'], {
      message: kind === 'device' ? '장치 코드 (선택; 실제 장치가 등록할 때 사용)' : '힌트 코드 (선택; 비우면 4자리 자동 생성)',
    });
  }

  let data: Record<string, unknown> | null = flags.data ? readJsonArg<Record<string, unknown>>(flags.data, '--data') : null;
  if (!data) {
    if (flags.file) {
      const uploaded = await uploadFile(ctx, themeId, flags.file);
      data = { fileKey: uploaded.key };
    } else if (flags.websiteUrl) {
      data = { mode: 'external', url: flags.websiteUrl };
    } else if (ctx.interactive()) {
      data = await wizardData(ctx, themeId, kind, name);
    } else {
      data = defaultData(kind, name);
      if (!data) {
        throw new ToolError(`${kind} 애셋은 --data (JSON) 가 필요합니다. 형식: rk describe asset ${kind}`, 'missing_input');
      }
    }
  }

  return {
    kind,
    name,
    ...(flags.description !== undefined && { description: flags.description }),
    ...(key ? { key } : {}),
    ...(code ? { code } : {}),
    ...(flags.tag?.length && { tagIds: flags.tag }),
    data,
  };
}

function printAsset(asset: Asset): void {
  out.line(
    kv([
      ['종류', asset.kind],
      ['이름', asset.name],
      ['키', asset.key],
      ['코드', asset.code],
      ['ID', asset.id],
      ['설명', asset.description || undefined],
      ['태그', asset.tags.length ? asset.tags.map((t) => t.name).join(', ') : undefined],
    ]),
  );
  out.line(pc.dim('data:'));
  out.line(JSON.stringify(asset.data, null, 2));
}

export function register(program: Command, ctx: GetContext): void {
  const asset = program.command('asset').description('애셋 관리 (list/get/create/update/delete)');

  asset
    .command('list')
    .description('테마의 애셋 목록 (요약)')
    .option('-k, --kind <kind>', `종류 필터 (${AssetKindSchema.options.join('|')})`)
    .option('--tag <ref>', '태그 필터 (uuid 또는 이름)')
    .option('-s, --search <text>', '이름/키/코드 부분 일치')
    .option('--data', '요약 대신 전체 data 포함')
    .action(async (opts: { kind?: string; tag?: string; search?: string; data?: boolean }) => {
      const c = ctx();
      const themeId = await resolveThemeId(c);
      const assets = await listAssets(c, themeId, { kind: opts.kind ? AssetKindSchema.parse(opts.kind) : undefined, tag: opts.tag, search: opts.search });
      const data = opts.data ? assets : assets.map(summarizeAsset);
      emit(c, data, () => {
        if (!assets.length) return out.info('애셋이 없습니다.');
        out.line(
          table(
            ['종류', '키', '이름', '코드', 'ID'],
            assets.map((a) => [a.kind, a.key ?? '', a.name, a.code ?? '', a.id]),
          ),
        );
      });
    });

  asset
    .command('get <ref>')
    .description('애셋 하나 (전체 data 포함). ref = uuid | 키 | 코드 | 이름')
    .action(async (ref: string) => {
      const c = ctx();
      const a = await getAsset(c, await resolveThemeId(c), ref);
      emit(c, a, () => printAsset(a));
    });

  asset
    .command('create')
    .description('애셋 만들기 (옵션이 없으면 대화형 마법사)')
    .option('-k, --kind <kind>', `종류 (${AssetKindSchema.options.join('|')})`)
    .option('-n, --name <name>', '이름')
    .option('--key <key>', KEY_HINT)
    .option('--code <code>', '장치/힌트 코드')
    .option('--description <text>', '설명')
    .option('--tag <ref>', '태그 (반복 가능)', collect)
    .option('--data <json>', 'data 페이로드: JSON, @파일, 또는 - (stdin). 형식: rk describe asset <kind>')
    .option('--file <path>', '미디어 종류: 파일을 업로드해 fileKey 로 설정')
    .option('--website-url <url>', 'website 종류: 외부 URL')
    .action(async (opts: CreateFlags) => {
      const c = ctx();
      const themeId = await resolveThemeId(c);
      const payload = await buildCreatePayload(c, themeId, opts);
      const created = await createAsset(c, themeId, payload);
      emit(c, created, () => {
        out.ok(`애셋 생성: ${created.kind} ${pc.bold(created.name)}${created.key ? ` (key=${created.key})` : ''} ${pc.dim(created.id)}`);
        if (created.kind === 'event') out.line(pc.dim(`시퀀스 작성: rk sequence set ${created.key ?? created.id} --sequence @seq.json`));
      });
    });

  asset
    .command('update <ref>')
    .description('애셋 수정. --data 는 전체 교체입니다 (먼저 get 으로 읽어 오세요)')
    .option('-n, --name <name>')
    .option('--key <key>', '키 (빈 문자열 = 제거)')
    .option('--code <code>')
    .option('--description <text>')
    .option('--tag <ref>', '태그 목록 전체 교체 (반복 가능)', collect)
    .option('--data <json>', 'data 전체 교체: JSON, @파일, - (stdin)')
    .action(async (ref: string, opts: { name?: string; key?: string; code?: string; description?: string; tag?: string[]; data?: string }) => {
      const c = ctx();
      const patch = {
        ...(opts.name !== undefined && { name: opts.name }),
        ...(opts.key !== undefined && { key: opts.key === '' ? null : opts.key }),
        ...(opts.code !== undefined && { code: opts.code }),
        ...(opts.description !== undefined && { description: opts.description }),
        ...(opts.tag && { tagIds: opts.tag }),
        ...(opts.data !== undefined && { data: readJsonArg<Record<string, unknown>>(opts.data, '--data') }),
      };
      if (!Object.keys(patch).length) throw new ToolError('변경할 항목을 지정해 주세요 (--name, --key, --data ...).', 'usage');
      const updated = await updateAsset(c, await resolveThemeId(c), ref, patch as Parameters<typeof updateAsset>[3]);
      emit(c, updated, () => out.ok(`애셋 수정: ${updated.kind} ${pc.bold(updated.name)} ${pc.dim(updated.id)}`));
    });

  asset
    .command('delete <ref>')
    .description('애셋 영구 삭제 (참조하는 시퀀스는 해당 커맨드를 건너뜁니다)')
    .action(async (ref: string) => {
      const c = ctx();
      const themeId = await resolveThemeId(c);
      const target = await getAsset(c, themeId, ref);
      const ok = await confirm(c, `${target.kind} "${target.name}" (${target.id}) 을 삭제할까요?`);
      if (!ok) throw new ToolError('cancelled', 'cancelled');
      const deleted = await deleteAsset(c, themeId, target.id);
      emit(c, { deleted: deleted.id, name: deleted.name, kind: deleted.kind }, () => out.ok(`애셋 삭제: ${deleted.name}`));
    });
}
