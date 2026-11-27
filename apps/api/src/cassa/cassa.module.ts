import { Module } from '@nestjs/common';
import { CassaController } from './cassa.controller.js';
import { CassaService } from './cassa.service.js';
import { ScadenzeService } from './scadenze.service.js';

@Module({
  controllers: [CassaController],
  providers: [CassaService, ScadenzeService],
  exports: [CassaService],
})
export class CassaModule {}
