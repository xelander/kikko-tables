import { Module } from '@nestjs/common';
import { ClienteModule } from '../cliente/cliente.module.js';
import { SalaStaffController } from './sala-staff.controller.js';
import { SalaController } from './sala.controller.js';
import { SalaService } from './sala.service.js';

@Module({
  imports: [ClienteModule],
  controllers: [SalaController, SalaStaffController],
  exports: [SalaService],
  providers: [SalaService],
})
export class SalaModule {}
