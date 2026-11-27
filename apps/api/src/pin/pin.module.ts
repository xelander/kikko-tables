import { Global, Module } from '@nestjs/common';
import { BlocchiService } from './blocchi.service.js';

@Global()
@Module({
  providers: [BlocchiService],
  exports: [BlocchiService],
})
export class PinModule {}
