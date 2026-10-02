// Audit Logging Module
// Creates queryable audit records for all protected operations.
// Never stores tokens, passwords, or unnecessary PII.

import { getDb } from '../../db/connection.js';
import type { AuditEntry } from '../../common/types.js';
import { v4 as uuidv4 } from 'uuid';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../db/schema.js';

/**
 * Record an audit event.
 * This operation must not fail silently - if audit storage is unavailable,
 * the calling operation should fail closed (deny access).
 */
export async function recordAuditEvent(entry: AuditEntry, db: Kysely<Database>|Transaction<Database> = getDb()): Promise<string> {
  const id = uuidv4();

  await db
    .insertInto('audit_events')
    .values({
      id,
      actor_id: entry.actorId,
      actor_type: entry.actorType,
      subject_id: entry.subjectId ?? null,
      organization_id: entry.organizationId,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId,
      decision: entry.decision,
      reason: entry.reason,
      correlation_id: entry.correlationId,
      ip_address: entry.ipAddress,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    })
    .execute();

  return id;
}

/**
 * Query audit events with filters.
 */
export async function queryAuditEvents(filters: {
  organizationId?: string;
  actorId?: string;
  action?: string;
  decision?: 'allow' | 'deny' | 'error';
  correlationId?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  let query = db.selectFrom('audit_events').selectAll();

  if (filters.organizationId) {
    query = query.where('organization_id', '=', filters.organizationId);
  }
  if (filters.actorId) {
    query = query.where('actor_id', '=', filters.actorId);
  }
  if (filters.action) {
    query = query.where('action', '=', filters.action);
  }
  if (filters.decision) {
    query = query.where('decision', '=', filters.decision);
  }
  if (filters.correlationId) {
    query = query.where('correlation_id', '=', filters.correlationId);
  }

  query = query.orderBy('timestamp', 'desc');
  query = query.limit(filters.limit ?? 50);
  if (filters.offset) {
    query = query.offset(filters.offset);
  }

  return query.execute();
}
