import { Module } from '@nestjs/common';
import { PlayersModule } from '../players/players.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [RuntimeModule, PlayersModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
