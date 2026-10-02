// ============================================================
// Security Test Suite: Identity & Membership Model (T01, T02)
// ============================================================
// T01: One user has different roles in two orgs; duplicate identity rejected
// T02: Duplicate membership and cross-tenant role assignment rejected
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { SEED_IDS } from '../helpers.js';

const { Client } = pg;

let client: pg.Client;

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe('T01: Identity model and multi-org roles', () => {
  it('Alice has admin role in Acme and learner role in Globex', async () => {
    // Verify Alice's roles in Acme
    const acmeRoles = await client.query(`
      SELECT r.name FROM membership_roles mr
      JOIN roles r ON r.id = mr.role_id
      JOIN memberships m ON m.id = mr.membership_id
      WHERE m.user_id = $1 AND m.organization_id = $2
    `, [SEED_IDS.USER_ALICE, SEED_IDS.ORG_ACME]);

    expect(acmeRoles.rows.map(r => r.name)).toContain('admin');

    // Verify Alice's roles in Globex
    const globexRoles = await client.query(`
      SELECT r.name FROM membership_roles mr
      JOIN roles r ON r.id = mr.role_id
      JOIN memberships m ON m.id = mr.membership_id
      WHERE m.user_id = $1 AND m.organization_id = $2
    `, [SEED_IDS.USER_ALICE, SEED_IDS.ORG_GLOBEX]);

    expect(globexRoles.rows.map(r => r.name)).toContain('learner');
    expect(globexRoles.rows.map(r => r.name)).not.toContain('admin');
  });

  it('each user has a unique authentication identity (issuer+subject)', async () => {
    const identities = await client.query(`
      SELECT issuer, subject, user_id FROM authentication_identities
      WHERE user_id IN ($1, $2, $3, $4, $5)
    `, [SEED_IDS.USER_ALICE, SEED_IDS.USER_BOB, SEED_IDS.USER_CHARLIE,
        SEED_IDS.USER_DIANA, SEED_IDS.USER_EVE]);

    // Each identity has unique issuer+subject
    const combos = identities.rows.map(r => `${r.issuer}::${r.subject}`);
    const uniqueCombos = new Set(combos);
    expect(uniqueCombos.size).toBe(combos.length);
  });

  it('duplicate issuer+subject is rejected by UNIQUE constraint', async () => {
    // First, get the actual issuer for alice's identity
    const existing = await client.query(
      `SELECT issuer FROM authentication_identities WHERE subject = '70000000-0000-0000-0000-000000000001' LIMIT 1`
    );
    const issuer = existing.rows[0]?.issuer || 'http://localhost:8180/realms/iam-platform';

    // Try to insert a duplicate issuer+subject under a different user
    await expect(
      client.query(`
        INSERT INTO authentication_identities (user_id, issuer, subject, email, email_verified)
        VALUES ($1, $2, '70000000-0000-0000-0000-000000000001', 'duplicate@test.com', false)
      `, [SEED_IDS.USER_BOB, issuer])
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('users are global and not tied to a specific organization', async () => {
    const user = await client.query(`SELECT * FROM users WHERE id = $1`, [SEED_IDS.USER_ALICE]);
    expect(user.rows).toHaveLength(1);
    // Users table has no organization_id column
    expect(user.rows[0]).not.toHaveProperty('organization_id');
  });
});

describe('T02: Membership constraints', () => {
  it('duplicate membership (same user, same org) is rejected', async () => {
    await expect(
      client.query(`
        INSERT INTO memberships (user_id, organization_id, status)
        VALUES ($1, $2, 'active')
      `, [SEED_IDS.USER_ALICE, SEED_IDS.ORG_ACME])
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('cross-tenant role assignment is rejected by trigger', async () => {
    // Try to assign a Globex role to an Acme membership
    await expect(
      client.query(`
        INSERT INTO membership_roles (membership_id, role_id)
        VALUES ($1, $2)
      `, [SEED_IDS.MEM_ALICE_ACME, SEED_IDS.ROLE_GLOBEX_ADMIN])
    ).rejects.toThrow(/same organization|foreign key/i);
  });

  it('teaching assignment cross-org is rejected by trigger', async () => {
    // Try to assign Bob (Acme) to teach Globex Course
    await expect(
      client.query(`
        INSERT INTO teaching_assignments (user_id, organization_id, resource_id, role)
        VALUES ($1, $2, $3, 'instructor')
      `, [SEED_IDS.USER_BOB, SEED_IDS.ORG_ACME, SEED_IDS.RES_GLOBEX_COURSE1])
    ).rejects.toThrow(/same organization/i);
  });

  it('Eve has inactive membership in Acme', async () => {
    const membership = await client.query(`
      SELECT status FROM memberships
      WHERE user_id = $1 AND organization_id = $2
    `, [SEED_IDS.USER_EVE, SEED_IDS.ORG_ACME]);

    expect(membership.rows).toHaveLength(1);
    expect(membership.rows[0].status).toBe('inactive');
  });
});
