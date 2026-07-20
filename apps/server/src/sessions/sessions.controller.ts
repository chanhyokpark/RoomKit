import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  AdjustTimerInputSchema,
  CreateSessionInputSchema,
  ListSessionsQuerySchema,
  ManualTriggerInputSchema,
  SwitchPhaseInputSchema,
  type AdjustTimerInput,
  type CreateSessionInput,
  type ListSessionsQuery,
  type ManualTriggerInput,
  type SwitchPhaseInput,
} from '@roomkit/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionRuntimeService } from '../runtime/session-runtime.service';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly runtime: SessionRuntimeService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListSessionsQuerySchema)) query: ListSessionsQuery,
  ) {
    return this.sessionsService.list(query);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateSessionInputSchema)) input: CreateSessionInput,
  ) {
    return this.sessionsService.create(input);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sessionsService.get(id);
  }

  @Post(':id/pause')
  async pause(@Param('id') id: string) {
    await this.sessionsService.get(id);
    await this.runtime.pause(id);
    return this.sessionsService.get(id);
  }

  @Post(':id/resume')
  async resume(@Param('id') id: string) {
    await this.sessionsService.get(id);
    await this.runtime.resume(id);
    return this.sessionsService.get(id);
  }

  @Post(':id/end')
  async end(@Param('id') id: string) {
    await this.sessionsService.get(id);
    await this.runtime.end(id);
    return this.sessionsService.get(id);
  }

  @Post(':id/timer')
  async adjustTimer(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdjustTimerInputSchema)) input: AdjustTimerInput,
  ) {
    await this.sessionsService.get(id);
    await this.runtime.adjustTimer(id, input);
    return this.sessionsService.get(id);
  }

  @Post(':id/phase')
  async switchPhase(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SwitchPhaseInputSchema)) input: SwitchPhaseInput,
  ) {
    await this.sessionsService.get(id);
    await this.runtime.switchPhase(id, input.phaseId);
    return this.sessionsService.get(id);
  }

  @Post(':id/trigger')
  @HttpCode(204)
  async trigger(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ManualTriggerInputSchema)) input: ManualTriggerInput,
  ) {
    await this.sessionsService.get(id);
    await this.runtime.manualTrigger(id, input.eventId);
  }

  @Post(':id/reset-devices')
  @HttpCode(204)
  async resetDevices(@Param('id') id: string) {
    await this.sessionsService.get(id);
    await this.runtime.resetAllDevices(id);
  }
}
