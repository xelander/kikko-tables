import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';
import { resolveMediaDir } from './config/media-dir.js';

export const API_PREFIX = 'api';

/** Shared app setup, used by main.ts and by the integration tests. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  // Dish photos: file names change when the photo changes, so they can be cached for a day.
  app.use('/media', express.static(resolveMediaDir(process.env), { maxAge: '1d', fallthrough: false, index: false }));
  const http: unknown = app.getHttpAdapter().getInstance();
  if (http && typeof (http as { disable?: unknown }).disable === 'function') {
    const express = http as { disable(setting: string): void; set(setting: string, value: unknown): void };
    express.disable('x-powered-by');
    const trustProxy = process.env['TRUST_PROXY'];
    if (trustProxy) express.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }
  app.enableShutdownHooks();
  return app;
}
