import { Module } from '@nestjs/common';
import { ClienteModule } from '../cliente/cliente.module.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [ClienteModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
