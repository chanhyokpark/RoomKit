import { Module } from '@nestjs/common';
import { LogsModule } from '../logs/logs.module';
import { CommandResolver } from './command-resolver';
import { SessionRuntimeService } from './session-runtime.service';

@Module({
  imports: [LogsModule],
  providers: [SessionRuntimeService, CommandResolver],
  exports: [SessionRuntimeService],
})
export class RuntimeModule {}
