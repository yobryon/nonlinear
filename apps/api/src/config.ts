export interface Config {
  port: number;
  host: string;
  storage: 'postgres' | 'memory';
  databaseUrl: string;
  /** Set true when serving over HTTPS so session cookies are Secure. */
  secureCookies: boolean;
  /** Directory for attachment blobs (fs blob store). */
  blobDir: string;
  /** Shared secret for the inbound GitHub webhook (HMAC sha256). Empty = disabled. */
  githubWebhookSecret: string;
  /** SMTP connection string for digest emails (smtp://host:port). Empty = digests off. */
  smtpUrl: string;
  smtpFrom: string;
  /** Public base URL used in emails and intake links. */
  appUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const storage = env.STORAGE === 'memory' ? 'memory' : 'postgres';
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    storage,
    databaseUrl: env.DATABASE_URL ?? 'postgres://nonlinear:nonlinear@localhost:5432/nonlinear',
    secureCookies: env.SECURE_COOKIES === 'true',
    blobDir: env.BLOB_DIR ?? './blobs',
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET ?? '',
    smtpUrl: env.SMTP_URL ?? '',
    smtpFrom: env.SMTP_FROM ?? 'nonlinear <no-reply@nonlinear.local>',
    appUrl: (env.APP_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  };
}
