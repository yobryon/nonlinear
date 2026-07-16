import { createDomain, createMemoryStorage, type Storage } from '@nonlinear/core';
import { createPostgresStorage } from '@nonlinear/storage-postgres';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  let storage: Storage;
  if (config.storage === 'postgres') {
    storage = await createPostgresStorage({ connectionString: config.databaseUrl });
  } else {
    storage = createMemoryStorage();
  }
  const domain = createDomain(storage);
  const app = await buildServer(domain, config);

  const shutdown = async (): Promise<void> => {
    await app.close();
    await storage.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`storage engine: ${config.storage}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
