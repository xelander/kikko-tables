import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { ConfigAdminService } from './config-admin.service.js';
import { FotoService } from './foto.service.js';
import { MenuAdminService } from './menu-admin.service.js';

@Module({
  controllers: [AdminController],
  providers: [ConfigAdminService, MenuAdminService, FotoService],
})
export class AdminModule {}
