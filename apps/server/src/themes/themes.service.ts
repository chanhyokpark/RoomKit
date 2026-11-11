import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateThemeInput, UpdateThemeInput } from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRuntimeService } from '../runtime/session-runtime.service';

@Injectable()
export class ThemesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: SessionRuntimeService,
  ) {}

  list() {
    return this.prisma.theme.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async get(id: string) {
    const theme = await this.prisma.theme.findUnique({ where: { id } });
    if (!theme) throw new NotFoundException('Theme not found');
    return theme;
  }

  create(input: CreateThemeInput) {
    return this.prisma.theme.create({
      data: { name: input.name, timeLimitMs: input.timeLimitMs ?? null },
    });
  }

  async update(id: string, input: UpdateThemeInput) {
    await this.get(id);
    return this.prisma.theme.update({ where: { id }, data: input });
  }

  /**
   * Deleting a theme cascades to its sessions, so live ones are ended first —
   * otherwise their engines keep running against rows that no longer exist.
   */
  async remove(id: string) {
    await this.get(id);
    const live = await this.prisma.session.findMany({
      where: { themeId: id, state: { not: 'ended' } },
      select: { id: true },
    });
    for (const session of live) await this.runtime.end(session.id);
    await this.prisma.theme.delete({ where: { id } });
  }
}
