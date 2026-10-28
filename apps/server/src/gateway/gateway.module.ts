import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { PlayersModule } from '../players/players.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { AdminGateway } from './admin.gateway';
import { CallService } from './call.service';
import { ConnectionRegistry } from './connection-registry';
import { DeviceGateway } from './device.gateway';
import { DeviceEvalService } from './device-eval.service';
import { PlayerGateway } from './player.gateway';
import { RuntimeTransportAdapter } from './runtime-transport.adapter';

@Module({
  imports: [RuntimeModule, AssetsModule, PlayersModule],
  providers: [
    ConnectionRegistry,
    CallService,
    DeviceGateway,
    DeviceEvalService,
    AdminGateway,
    PlayerGateway,
    RuntimeTransportAdapter,
  ],
  exports: [DeviceEvalService],
})
export class GatewayModule {}
