import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateTagInput, UpdateTagInput } from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ThemeEventsService } from '../theme-events/theme-events.service';

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly themeEvents: ThemeEventsService,
  ) {}

  list(themeId: string) {
    return this.prisma.tag.findMany({
      where: { themeId },
      orderBy: { name: 'asc' },
    });
  }

  async create(themeId: string, input: CreateTagInput) {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!theme) throw new NotFoundException('Theme not found');
    try {
      const created = await this.prisma.tag.create({
        data: { themeId, ...input },
      });
      this.themeEvents.assetsChanged(themeId);
      return created;
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('Tag name already exists in this theme');
      }
      throw e;
    }
  }

  async update(themeId: string, id: string, input: UpdateTagInput) {
    await this.get(themeId, id);
    try {
      const updated = await this.prisma.tag.update({
        where: { id },
        data: input,
      });
      this.themeEvents.assetsChanged(themeId);
      return updated;
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('Tag name already exists in this theme');
      }
      throw e;
    }
  }

  async remove(themeId: string, id: string) {
    await this.get(themeId, id);
    await this.prisma.tag.delete({ where: { id } });
    this.themeEvents.assetsChanged(themeId);
  }

  private async get(themeId: string, id: string) {
    const tag = await this.prisma.tag.findFirst({ where: { id, themeId } });
    if (!tag) throw new NotFoundException('Tag not found');
    return tag;
  }
}
