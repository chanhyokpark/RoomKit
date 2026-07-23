import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { PlayersModule } from '../players/players.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { AdminGateway } from './admin.gateway';
import { ConnectionRegistry } from './connection-registry';
import { DeviceGateway } from './device.gateway';
import { PlayerGateway } from './player.gateway';
import { RuntimeTransportAdapter } from './runtime-transport.adapter';

@Module({
  imports: [RuntimeModule, AssetsModule, PlayersModule],
  providers: [
    ConnectionRegistry,
    DeviceGateway,
    AdminGateway,
    PlayerGateway,
    RuntimeTransportAdapter,
  ],
})
export class GatewayModule {}
