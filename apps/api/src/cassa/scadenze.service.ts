import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { CassaService } from './cassa.service.js';

/**
 * Looks for sessions past their maximum duration every few seconds (CONTROLLO_SCADENZE_SECONDI).
 * Deadlines are computed from the times stored in the database, so a restart after a blackout
 * catches up at once (the first check runs at startup).
 */
@Injectable()
export class ScadenzeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScadenzeService.name);
  private timer: NodeJS.Timeout | undefined;
  private inCorso = false;

  constructor(
    private readonly cassa: CassaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const secondi = this.config.get('CONTROLLO_SCADENZE_SECONDI', { infer: true });
    if (secondi <= 0) return;
    void this.controlla();
    this.timer = setInterval(() => void this.controlla(), secondi * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async controlla(): Promise<void> {
    if (this.inCorso) return;
    this.inCorso = true;
    try {
      await this.cassa.controllaScadenze();
    } catch (error) {
      this.logger.warn(`Expiry check failed: ${(error as Error).message}`);
    } finally {
      this.inCorso = false;
    }
  }
}
