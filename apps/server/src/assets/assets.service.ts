import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assetDataSchemas,
  CODED_ASSET_KINDS,
  PlayerDataSchema,
  type AssetKind,
  type CreateAssetInput,
  type UpdateAssetInput,
} from '@roomkit/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';

const HINT_CODE_ATTEMPTS = 20;

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  list(themeId: string, filter: { kind?: AssetKind; tagId?: string }) {
    return this.prisma.asset.findMany({
      where: {
        themeId,
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.tagId ? { tags: { some: { id: filter.tagId } } } : {}),
      },
      include: { tags: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(themeId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id, themeId },
      include: { tags: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async create(themeId: string, input: CreateAssetInput) {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!theme) throw new NotFoundException('Theme not found');

    await this.checkTagsBelongToTheme(themeId, input.tagIds);
    await this.checkDataReferences(themeId, input.kind, input.data);

    const base = {
      themeId,
      kind: input.kind,
      name: input.name,
      data: input.data as Prisma.InputJsonValue,
      tags: input.tagIds
        ? { connect: input.tagIds.map((id) => ({ id })) }
        : undefined,
    };

    if (input.kind === 'hint' && input.code === undefined) {
      return this.createHintWithGeneratedCode(base);
    }

    const code = 'code' in input ? input.code : null;
    try {
      return await this.prisma.asset.create({
        data: { ...base, code },
        include: { tags: true },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `Code "${code}" already exists in this theme`,
        );
      }
      throw e;
    }
  }

  async update(themeId: string, id: string, input: UpdateAssetInput) {
    const asset = await this.get(themeId, id);

    if (
      input.code !== undefined &&
      !(CODED_ASSET_KINDS as string[]).includes(asset.kind)
    ) {
      throw new BadRequestException(
        `Assets of kind "${asset.kind}" have no code`,
      );
    }

    let data: Prisma.InputJsonValue | undefined;
    if (input.data !== undefined) {
      // Full replacement, validated against the stored asset's kind
      const parsed = assetDataSchemas[asset.kind].safeParse(input.data);
      if (!parsed.success) {
        throw new BadRequestException({
          message: `Invalid data for asset kind "${asset.kind}"`,
          errors: z.treeifyError(parsed.error as z.ZodError<unknown>),
        });
      }
      await this.checkDataReferences(themeId, asset.kind, parsed.data);
      data = parsed.data;
    }

    await this.checkTagsBelongToTheme(themeId, input.tagIds);

    try {
      return await this.prisma.asset.update({
        where: { id },
        data: {
          name: input.name,
          code: input.code,
          data,
          tags: input.tagIds
            ? { set: input.tagIds.map((tagId) => ({ id: tagId })) }
            : undefined,
        },
        include: { tags: true },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `Code "${input.code}" already exists in this theme`,
        );
      }
      throw e;
    }
  }

  async remove(themeId: string, id: string) {
    await this.get(themeId, id);
    await this.prisma.asset.delete({ where: { id } });
  }

  private async createHintWithGeneratedCode(
    base: Prisma.AssetUncheckedCreateInput,
  ) {
    for (let attempt = 0; attempt < HINT_CODE_ATTEMPTS; attempt++) {
      const code = String(randomInt(0, 10000)).padStart(4, '0');
      try {
        return await this.prisma.asset.create({
          data: { ...base, code },
          include: { tags: true },
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    throw new ConflictException(
      'Could not generate a unique hint code; set one manually',
    );
  }

  private async checkTagsBelongToTheme(themeId: string, tagIds?: string[]) {
    if (!tagIds?.length) return;
    const count = await this.prisma.tag.count({
      where: { id: { in: tagIds }, themeId },
    });
    if (count !== new Set(tagIds).size) {
      throw new BadRequestException(
        'One or more tags do not exist in this theme',
      );
    }
  }

  /** Validates cross-references inside `data` (e.g. player → device ids). */
  private async checkDataReferences(
    themeId: string,
    kind: AssetKind,
    data: unknown,
  ) {
    if (kind !== 'player') return;
    const { speakerDeviceId, screenDeviceId } = PlayerDataSchema.parse(data);
    const deviceIds = [...new Set([speakerDeviceId, screenDeviceId])];
    const count = await this.prisma.asset.count({
      where: { id: { in: deviceIds }, themeId, kind: 'device' },
    });
    if (count !== deviceIds.length) {
      throw new BadRequestException(
        'speakerDeviceId/screenDeviceId must reference device assets in this theme',
      );
    }
  }
}
