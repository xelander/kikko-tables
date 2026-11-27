import { Module } from '@nestjs/common';
import { FormuleController } from './formule.controller.js';

@Module({ controllers: [FormuleController] })
export class FormuleModule {}
