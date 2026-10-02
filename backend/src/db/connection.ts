// Database configuration and connection
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { Database } from './schema.js';

const { Pool } = pg;

let db: Kysely<Database> | null = null;

export function getDb(): Kysely<Database> {
  if (!db) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
    });
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
    });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
  }
}
