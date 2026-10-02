// Learning Resource API Module
// All resource queries are scoped to the organization context.
// Resources are loaded by BOTH resource ID and organization ID to prevent cross-tenant access.

import { getDb } from '../../db/connection.js';

/**
 * Get a learning resource by ID, scoped to an organization.
 * Returns null if the resource doesn't exist OR belongs to a different org.
 * This prevents cross-tenant resource access - the caller cannot distinguish
 * "resource doesn't exist" from "resource belongs to another org."
 */
export async function getResourceByIdAndOrg(
  resourceId: string,
  organizationId: string
) {
  const db = getDb();

  return db
    .selectFrom('learning_resources')
    .selectAll()
    .where('id', '=', resourceId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
}

/**
 * List learning resources for an organization.
 * Always filtered by organization_id - never returns cross-tenant data.
 */
export async function listResourcesByOrg(
  organizationId: string,
  filters?: {
    resourceType?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
) {
  const db = getDb();

  let query = db
    .selectFrom('learning_resources')
    .selectAll()
    .where('organization_id', '=', organizationId);

  if (filters?.resourceType) {
    query = query.where('resource_type', '=', filters.resourceType as any);
  }
  if (filters?.status) {
    query = query.where('status', '=', filters.status as any);
  }

  query = query.orderBy('created_at', 'desc');
  query = query.limit(filters?.limit ?? 50);
  if (filters?.offset) {
    query = query.offset(filters.offset);
  }

  return query.execute();
}

/**
 * Get teaching assignments for a user in an organization.
 */
export async function getTeachingAssignments(
  userId: string,
  organizationId: string
) {
  const db = getDb();

  return db
    .selectFrom('teaching_assignments')
    .innerJoin('learning_resources', 'learning_resources.id', 'teaching_assignments.resource_id')
    .select([
      'teaching_assignments.id',
      'teaching_assignments.resource_id as resourceId',
      'teaching_assignments.role',
      'learning_resources.title as resourceTitle',
      'learning_resources.resource_type as resourceType',
    ])
    .where('teaching_assignments.user_id', '=', userId)
    .where('teaching_assignments.organization_id', '=', organizationId)
    .execute();
}
