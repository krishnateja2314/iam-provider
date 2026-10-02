import pg from 'pg';
import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { migrationSql as initial } from './migrations/001-initial.js';
import { migrationSql as boundaries } from './migrations/002-boundaries.js';

dotenv.config();

export async function migrate(connectionString = process.env.DATABASE_URL): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(73419201)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const [version, statement] of [[1, initial], [2, boundaries]] as const) {
      const checksum = createHash('sha256').update(statement).digest('hex');
      const existing = await client.query('SELECT checksum FROM schema_migrations WHERE version = $1', [version]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Migration ${version} checksum mismatch`);
        continue;
      }
      await client.query(statement);
      await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [version, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate().then(() => console.log('Migrations completed successfully.')).catch(error => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  });
}
