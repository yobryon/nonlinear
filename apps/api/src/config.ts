export interface Config {
  port: number;
  host: string;
  storage: 'postgres' | 'memory';
  databaseUrl: string;
  /** Set true when serving over HTTPS so session cookies are Secure. */
  secureCookies: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const storage = env.STORAGE === 'memory' ? 'memory' : 'postgres';
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    storage,
    databaseUrl:
      env.DATABASE_URL ?? 'postgres://nonlinear:nonlinear@localhost:5432/nonlinear',
    secureCookies: env.SECURE_COOKIES === 'true',
  };
}
