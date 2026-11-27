import { Global, Module } from '@nestjs/common';
import { EventiService } from './eventi.service.js';

@Global()
@Module({
  providers: [EventiService],
  exports: [EventiService],
})
export class EventiModule {}
