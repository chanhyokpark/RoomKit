import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { CommandResolver } from './command-resolver';
import { DeviceLogsService } from './device-logs.service';
import { HintService } from './hint.service';
import { SessionRuntimeService } from './session-runtime.service';

@Module({
  imports: [LogsModule],
  providers: [
    SessionRuntimeService,
    CommandResolver,
    HintService,
    DeviceLogsService,
  ],
  exports: [SessionRuntimeService, CommandResolver, DeviceLogsService],
})
export class RuntimeModule {}
