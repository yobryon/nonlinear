import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Pool } from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize concurrent migrators (e.g. two api replicas starting at once).
      await client.query('LOCK TABLE schema_migrations IN ACCESS EXCLUSIVE MODE');
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [
        file,
      ]);
      if (rowCount === 0) {
        const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
