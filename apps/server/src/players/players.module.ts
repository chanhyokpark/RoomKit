import { Module } from '@nestjs/common';
import { PlayerRegistry } from './player-registry';

@Module({
  providers: [PlayerRegistry],
  exports: [PlayerRegistry],
})
export class PlayersModule {}
