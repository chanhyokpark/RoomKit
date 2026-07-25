import { Module } from '@nestjs/common';
import { PlayersModule } from '../players/players.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { WebsiteTestController } from './website-test.controller';
import { WebsiteTestService } from './website-test.service';

@Module({
  imports: [RuntimeModule, PlayersModule],
  controllers: [WebsiteTestController],
  providers: [WebsiteTestService],
  exports: [WebsiteTestService],
})
export class WebsiteTestModule {}
