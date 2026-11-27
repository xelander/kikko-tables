import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveDatabaseUrl } from '../src/config/database-url.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { runSeed } from '../src/seed/seed-runner.js';

const isProduction = process.env['NODE_ENV'] === 'production';
const adminUsername = process.env['SEED_ADMIN_USERNAME'] || 'admin';
const adminPassword = process.env['SEED_ADMIN_PASSWORD'] || (isProduction ? undefined : 'admin');

if (!adminPassword) {
  console.error('SEED_ADMIN_PASSWORD is required in production');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveDatabaseUrl(process.env) }) });

try {
  const summary = await runSeed(prisma, { adminUsername, adminPassword });
  console.log(
    `Seed completed: ${summary.formule} formulas, ${summary.categorie} categories, ` +
      `${summary.piatti} dishes, ${summary.tavoli} tables, admin "${adminUsername}" ` +
      (summary.adminCreated ? 'created' : 'already present (password unchanged)'),
  );
} catch (error) {
  console.error('Seed failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
