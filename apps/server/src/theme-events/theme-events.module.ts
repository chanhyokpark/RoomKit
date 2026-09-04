import { Global, Module } from '@nestjs/common';
import { ThemeEventsService } from './theme-events.service';

@Global()
@Module({
  providers: [ThemeEventsService],
  exports: [ThemeEventsService],
})
export class ThemeEventsModule {}
