export interface Config {
  port: number;
  host: string;
  storage: 'postgres' | 'memory';
  databaseUrl: string;
  /** Set true when serving over HTTPS so session cookies are Secure. */
  secureCookies: boolean;
  /** Directory for attachment blobs (fs blob store). */
  blobDir: string;
  /**
   * Attachment blob backend. Azure Blob when a connection string is set
   * (portable Azure target), else the fs volume for postgres / memory for
   * memory storage. Selected at boot in index.ts.
   */
  azureBlob: {
    connectionString: string;
    container: string;
  };
  /** Shared secret for the inbound GitHub webhook (HMAC sha256). Empty = disabled. */
  githubWebhookSecret: string;
  /** SMTP connection string for digest emails (smtp://host:port). Empty = digests off. */
  smtpUrl: string;
  smtpFrom: string;
  /** Public base URL used in emails and intake links. */
  appUrl: string;
  /** OIDC single sign-on. `issuer` + `clientId` empty = SSO disabled. */
  sso: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    /** Button label on the login page, e.g. "Microsoft Entra ID". */
    label: string;
    /** Only provision/allow accounts whose email ends with one of these (comma-sep). Empty = any. */
    allowedDomains: string[];
    /** Auto-create a member on first SSO login for an unknown email. */
    autoProvision: boolean;
  };
  /** Bearer token guarding the SCIM 2.0 provisioning endpoints. Empty = SCIM off. */
  scimToken: string;
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
    azureBlob: {
      connectionString: env.AZURE_BLOB_CONNECTION_STRING ?? '',
      container: env.AZURE_BLOB_CONTAINER ?? 'attachments',
    },
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET ?? '',
    smtpUrl: env.SMTP_URL ?? '',
    smtpFrom: env.SMTP_FROM ?? 'nonlinear <no-reply@nonlinear.local>',
    appUrl: (env.APP_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
    sso: {
      issuer: (env.OIDC_ISSUER ?? '').replace(/\/$/, ''),
      clientId: env.OIDC_CLIENT_ID ?? '',
      clientSecret: env.OIDC_CLIENT_SECRET ?? '',
      label: env.OIDC_LABEL ?? 'Single sign-on',
      allowedDomains: (env.OIDC_ALLOWED_DOMAINS ?? '')
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
      autoProvision: env.OIDC_AUTO_PROVISION !== 'false',
    },
    scimToken: env.SCIM_TOKEN ?? '',
  };
}
