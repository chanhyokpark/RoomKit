import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { CommandResolver } from './command-resolver';
import { HintService } from './hint.service';
import { SessionRuntimeService } from './session-runtime.service';

@Module({
  imports: [LogsModule],
  providers: [SessionRuntimeService, CommandResolver, HintService],
  exports: [SessionRuntimeService, CommandResolver],
})
export class RuntimeModule {}
