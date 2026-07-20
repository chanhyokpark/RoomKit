import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { AdminGateway } from './admin.gateway';
import { ConnectionRegistry } from './connection-registry';
import { DeviceGateway } from './device.gateway';
import { RuntimeTransportAdapter } from './runtime-transport.adapter';

@Module({
  imports: [RuntimeModule, AssetsModule],
  providers: [
    ConnectionRegistry,
    DeviceGateway,
    AdminGateway,
    RuntimeTransportAdapter,
  ],
})
export class GatewayModule {}
