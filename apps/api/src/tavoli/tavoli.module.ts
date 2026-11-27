import { Module } from '@nestjs/common';
import { SeduteService } from './sedute.service.js';
import { TavoliController } from './tavoli.controller.js';

@Module({
  controllers: [TavoliController],
  providers: [SeduteService],
  exports: [SeduteService],
})
export class TavoliModule {}
