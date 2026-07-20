import { Injectable, NotFoundException } from '@nestjs/common';
import type { JsonValue, ListLogsQuery, LogKind, LogLevel } from '@roomkit/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface AppendLogInput {
  level: LogLevel;
  kind: LogKind;
  message: string;
  data?: JsonValue;
}

@Injectable()
export class LogsService {
  constructor(private readonly prisma: PrismaService) {}

  append(sessionId: string, input: AppendLogInput) {
    return this.prisma.sessionLog.create({
      data: {
        sessionId,
        level: input.level,
        kind: input.kind,
        message: input.message,
        data: input.data === undefined ? undefined : (input.data as object),
      },
    });
  }

  async list(sessionId: string, query: ListLogsQuery) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    return this.prisma.sessionLog.findMany({
      where: {
        sessionId,
        ...(query.afterId !== undefined ? { id: { gt: query.afterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit,
    });
  }
}
