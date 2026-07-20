import { Controller, Get, Param, Query } from '@nestjs/common';
import { ListLogsQuerySchema, type ListLogsQuery } from '@roomkit/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LogsService } from './logs.service';

@Controller('sessions')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get(':id/logs')
  list(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ListLogsQuerySchema)) query: ListLogsQuery,
  ) {
    return this.logsService.list(id, query);
  }
}
