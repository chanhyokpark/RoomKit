import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { DuplicateThemeInput } from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { remapAssetData } from './asset-data-refs';

/**
 * Deep-copies a theme: tags and every asset, with all cross-asset id
 * references inside `data` JSON remapped to the copies' ids. Only two kinds
 * carry refs — player (device ids) and event (phaseId + sequence command
 * refs, walked via COMMAND_ASSET_REFS).
 *
 * S3 fileKeys are shared with the source theme, not copied: nothing deletes
 * S3 objects today, so shared keys cannot be orphaned, and the player cache
 * (keyed by fileKey) is reused across duplicated rooms. Any future S3 GC must
 * treat a key as live if ANY theme's Asset.data references it.
 */
@Injectable()
export class ThemeDuplicator {
  constructor(private readonly prisma: PrismaService) {}

  async duplicate(themeId: string, input: DuplicateThemeInput) {
    const source = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!source) throw new NotFoundException('Theme not found');

    const [tags, assets] = await Promise.all([
      this.prisma.tag.findMany({ where: { themeId } }),
      this.prisma.asset.findMany({
        where: { themeId },
        include: { tags: { select: { id: true } } },
      }),
    ]);

    // Pre-generate every new id so refs can be remapped in a single pass
    // regardless of creation order.
    const assetIdMap = new Map(assets.map((a) => [a.id, randomUUID()]));
    const tagIdMap = new Map(tags.map((t) => [t.id, randomUUID()]));

    return this.prisma.$transaction(
      async (tx) => {
        const theme = await tx.theme.create({
          data: {
            name: input.name ?? `${source.name} (사본)`,
            timeLimitMs: source.timeLimitMs,
          },
        });
        if (tags.length > 0) {
          await tx.tag.createMany({
            data: tags.map((tag) => ({
              id: tagIdMap.get(tag.id),
              themeId: theme.id,
              name: tag.name,
              color: tag.color,
            })),
          });
        }
        for (const asset of assets) {
          await tx.asset.create({
            data: {
              id: assetIdMap.get(asset.id),
              themeId: theme.id,
              kind: asset.kind,
              name: asset.name,
              description: asset.description,
              code: asset.code,
              data: remapAssetData(asset.kind, asset.data, assetIdMap),
              tags: {
                connect: asset.tags.map((t) => ({ id: tagIdMap.get(t.id) })),
              },
            },
          });
        }
        return theme;
      },
      { timeout: 30_000 },
    );
  }
}
