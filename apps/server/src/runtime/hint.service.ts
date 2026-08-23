import { Injectable } from '@nestjs/common';
import {
  DeviceDataSchema,
  HintDataSchema,
  type HintData,
  type HintShow,
} from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MEDIA_URL_EXPIRES_IN } from './command-resolver';

export interface ResolvedHint {
  id: string;
  code: string;
  data: HintData;
}

/**
 * Hint lookup and payload building. Hints are theme-scoped: codes are unique
 * per (theme, kind) and HintData carries no phase association, so there is no
 * phase filtering — the SPEC's "current session/phase" resolves at the
 * session (= theme) level.
 */
@Injectable()
export class HintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findByCode(
    themeId: string,
    code: string,
  ): Promise<ResolvedHint | null> {
    // findFirst: `code` is nullable, so the compound unique isn't findUnique-friendly.
    const row = await this.prisma.asset.findFirst({
      where: { themeId, kind: 'hint', code },
    });
    return this.toResolved(row);
  }

  async findById(
    themeId: string,
    hintId: string,
  ): Promise<ResolvedHint | null> {
    const row = await this.prisma.asset.findFirst({
      where: { id: hintId, themeId, kind: 'hint' },
    });
    return this.toResolved(row);
  }

  async isHintDevice(themeId: string, deviceId: string): Promise<boolean> {
    const row = await this.prisma.asset.findFirst({
      where: { id: deviceId, themeId, kind: 'device' },
      select: { data: true },
    });
    if (!row) return false;
    const parsed = DeviceDataSchema.safeParse(row.data);
    return parsed.success && parsed.data.isHintDevice;
  }

  /** All device asset ids in the theme flagged as hint devices. */
  async hintDeviceIds(themeId: string): Promise<string[]> {
    const rows = await this.prisma.asset.findMany({
      where: { themeId, kind: 'device' },
      select: { id: true, data: true },
    });
    return rows
      .filter((row) => {
        const parsed = DeviceDataSchema.safeParse(row.data);
        return parsed.success && parsed.data.isHintDevice;
      })
      .map((row) => row.id);
  }

  /**
   * Highest step index a device may request: regular steps are
   * 0..steps.length-1; the explicit answer (when present) is steps.length.
   */
  static stepBound(data: HintData): number {
    return data.steps.length + (data.answer ? 1 : 0);
  }

  /** Caller must have validated `step` against {@link HintService.stepBound}. */
  async buildShow(hint: ResolvedHint, step: number): Promise<HintShow> {
    const isAnswer = step === hint.data.steps.length;
    const s = isAnswer ? hint.data.answer! : hint.data.steps[step];
    return {
      hintId: hint.id,
      code: hint.code,
      step,
      stepCount: hint.data.steps.length,
      hasAnswer: hint.data.answer !== null,
      isAnswer,
      textHtml: s.textHtml,
      imageUrl: s.imageKey
        ? await this.storage.presignGet(s.imageKey, MEDIA_URL_EXPIRES_IN)
        : null,
    };
  }

  private toResolved(
    row: { id: string; code: string | null; data: unknown } | null,
  ): ResolvedHint | null {
    if (!row || row.code === null) return null;
    const parsed = HintDataSchema.safeParse(row.data);
    if (!parsed.success) return null;
    return { id: row.id, code: row.code, data: parsed.data };
  }
}
