import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { ClienteModule } from './cliente/cliente.module.js';
import { type Env, validateEnv } from './config/env.js';
import { EventiModule } from './eventi/eventi.module.js';
import { FormuleModule } from './formule/formule.module.js';
import { HealthModule } from './health/health.module.js';
import { PinModule } from './pin/pin.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { TavoliModule } from './tavoli/tavoli.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        { name: 'default', ttl: 60_000, limit: config.get('THROTTLE_DEFAULT_LIMIT', { infer: true }) },
      ],
    }),
    PrismaModule,
    EventiModule,
    PinModule,
    HealthModule,
    AuthModule,
    FormuleModule,
    TavoliModule,
    ClienteModule,
    RealtimeModule,
  ],
  // Rate limiting runs before authentication (AuthGuard is registered in AuthModule).
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
