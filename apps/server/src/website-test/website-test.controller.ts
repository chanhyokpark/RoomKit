import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateWebsiteTestInputSchema,
  RunWebsiteTestEventInputSchema,
  UpdateWebsiteTestInputSchema,
  WebsiteTestCommandInputSchema,
  WebsiteTestTimerInputSchema,
  type CreateWebsiteTestInput,
  type RunWebsiteTestEventInput,
  type UpdateWebsiteTestInput,
  type WebsiteTestCommandInput,
  type WebsiteTestTimerInput,
} from '@roomkit/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WebsiteTestService } from './website-test.service';

const ListQuerySchema = z.object({ themeId: z.uuid().optional() });

@Controller('website-test')
export class WebsiteTestController {
  constructor(private readonly websiteTest: WebsiteTestService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateWebsiteTestInputSchema))
    input: CreateWebsiteTestInput,
  ) {
    return this.websiteTest.createRun(input);
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(ListQuerySchema))
    query: z.infer<typeof ListQuerySchema>,
  ) {
    return this.websiteTest.listRuns(query.themeId);
  }

  @Get(':runId')
  get(@Param('runId') runId: string) {
    return this.websiteTest.getRun(runId);
  }

  /** Buffered activity entries, for studio rehydrate after a reload. */
  @Get(':runId/activity')
  activity(@Param('runId') runId: string) {
    return this.websiteTest.getActivity(runId);
  }

  @Delete(':runId')
  @HttpCode(204)
  stop(@Param('runId') runId: string) {
    this.websiteTest.stopRun(runId);
  }

  @Post(':runId/command')
  @HttpCode(204)
  async command(
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(WebsiteTestCommandInputSchema))
    input: WebsiteTestCommandInput,
  ) {
    await this.websiteTest.executeManualCommand(runId, input.command);
  }

  @Post(':runId/run-event')
  @HttpCode(204)
  async runEvent(
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(RunWebsiteTestEventInputSchema))
    input: RunWebsiteTestEventInput,
  ) {
    await this.websiteTest.runEvent(runId, input.eventId);
  }

  @Post(':runId/cancel-run')
  @HttpCode(204)
  cancelRun(@Param('runId') runId: string) {
    this.websiteTest.cancelEventRun(runId);
  }

  @Post(':runId/reload')
  @HttpCode(204)
  reload(@Param('runId') runId: string) {
    this.websiteTest.reload(runId);
  }

  @Post(':runId/timer')
  timer(
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(WebsiteTestTimerInputSchema))
    input: WebsiteTestTimerInput,
  ) {
    return this.websiteTest.setTimer(runId, input);
  }

  @Patch(':runId')
  async update(
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(UpdateWebsiteTestInputSchema))
    input: UpdateWebsiteTestInput,
  ) {
    if (input.url !== undefined) this.websiteTest.setUrl(runId, input.url);
    if (input.phaseId !== undefined) {
      await this.websiteTest.setPhase(runId, input.phaseId);
    }
    return this.websiteTest.getRun(runId);
  }
}
