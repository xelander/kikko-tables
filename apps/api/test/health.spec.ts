import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

async function createApp(overridePrisma?: Partial<PrismaService>): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (overridePrisma) builder = builder.overrideProvider(PrismaService).useValue(overridePrisma);
  const moduleRef = await builder.compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.init();
  return app;
}

describe('GET /api/health', () => {
  describe('with the database up', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await createApp();
    });
    afterAll(async () => {
      await app.close();
    });

    it('answers 200 with database up', async () => {
      const res = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', database: 'up', version: '0.0.0-dev' });
      expect(typeof res.body.uptimeSeconds).toBe('number');
      expect(new Date(res.body.time).toString()).not.toBe('Invalid Date');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('serves routes only under the /api prefix', async () => {
      await request(app.getHttpServer()).get('/health').expect(404);
    });
  });

  describe('with the database down', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await createApp({
        isHealthy: async () => false,
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
      });
    });
    afterAll(async () => {
      await app.close();
    });

    it('answers 503 and reports the database down', async () => {
      const res = await request(app.getHttpServer()).get('/api/health').expect(503);
      expect(res.body).toMatchObject({ status: 'degraded', database: 'down' });
    });
  });
});

describe('PrismaService.isHealthy', () => {
  it('returns false when the database is unreachable', async () => {
    const { ConfigService } = await import('@nestjs/config');
    const config = new ConfigService({ DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none' });
    const prisma = new PrismaService(config as never);
    expect(await prisma.isHealthy(1500)).toBe(false);
    await prisma.$disconnect();
  });
});
