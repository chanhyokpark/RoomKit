import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateThemeInput, UpdateThemeInput } from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ThemesService {
  constructor(private readonly prisma: PrismaService) {}

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

  async remove(id: string) {
    await this.get(id);
    await this.prisma.theme.delete({ where: { id } });
  }
}
