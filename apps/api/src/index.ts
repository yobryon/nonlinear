import {
  createDomain,
  createFsBlobStore,
  createMemoryBlobStore,
  createMemoryStorage,
  type Storage,
} from '@nonlinear/core';
import { createPostgresStorage } from '@nonlinear/storage-postgres';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';
import { createDigestSender } from './digest.js';

const DUE_SOON_INTERVAL_MS = 10 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  let storage: Storage;
  if (config.storage === 'postgres') {
    storage = await createPostgresStorage({ connectionString: config.databaseUrl });
  } else {
    storage = createMemoryStorage();
  }
  const blobs =
    config.storage === 'postgres' ? createFsBlobStore(config.blobDir) : createMemoryBlobStore();
  const domain = createDomain(storage, { blobs });
  const app = await buildServer(domain, config);

  const stopWebhooks = domain.webhooks.startDispatcher((msg) => app.log.warn(msg));
  const scan = () => {
    void domain.dueSoon.scan().catch((err) => app.log.error(err, 'due-soon scan failed'));
    void domain.reminders.scan().catch((err) => app.log.error(err, 'reminder scan failed'));
  };
  const dueSoonTimer = setInterval(scan, DUE_SOON_INTERVAL_MS);
  scan();

  let digestTimer: ReturnType<typeof setInterval> | null = null;
  if (config.smtpUrl) {
    const sendDigests = createDigestSender(domain, config.smtpUrl, config.smtpFrom, config.appUrl);
    const runDigests = () => {
      void sendDigests()
        .then((n) => {
          if (n > 0) app.log.info(`sent ${n} digest email(s)`);
        })
        .catch((err) => app.log.error(err, 'digest send failed'));
    };
    digestTimer = setInterval(runDigests, 60 * 60 * 1000);
    setTimeout(runDigests, 30_000);
    app.log.info('email digests enabled');
  }

  const shutdown = async (): Promise<void> => {
    clearInterval(dueSoonTimer);
    if (digestTimer) clearInterval(digestTimer);
    stopWebhooks();
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
