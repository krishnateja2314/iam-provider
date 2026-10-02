// Seed data: Two synthetic organizations with users in different roles
// All data is synthetic. No real identities or credentials.

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

// Fixed UUIDs for reproducible testing
const IDS = {
  // Organizations
  ORG_ACME: '10000000-0000-0000-0000-000000000001',
  ORG_GLOBEX: '10000000-0000-0000-0000-000000000002',

  // Users
  USER_ALICE: '20000000-0000-0000-0000-000000000001',
  USER_BOB: '20000000-0000-0000-0000-000000000002',
  USER_CHARLIE: '20000000-0000-0000-0000-000000000003',
  USER_DIANA: '20000000-0000-0000-0000-000000000004',
  USER_EVE: '20000000-0000-0000-0000-000000000005',

  // Memberships
  MEM_ALICE_ACME: '30000000-0000-0000-0000-000000000001',
  MEM_ALICE_GLOBEX: '30000000-0000-0000-0000-000000000002',
  MEM_BOB_ACME: '30000000-0000-0000-0000-000000000003',
  MEM_CHARLIE_ACME: '30000000-0000-0000-0000-000000000004',
  MEM_DIANA_GLOBEX: '30000000-0000-0000-0000-000000000005',
  MEM_EVE_ACME: '30000000-0000-0000-0000-000000000006',

  // Roles (per org)
  ROLE_ACME_ADMIN: '40000000-0000-0000-0000-000000000001',
  ROLE_ACME_INSTRUCTOR: '40000000-0000-0000-0000-000000000002',
  ROLE_ACME_LEARNER: '40000000-0000-0000-0000-000000000003',
  ROLE_GLOBEX_ADMIN: '40000000-0000-0000-0000-000000000004',
  ROLE_GLOBEX_INSTRUCTOR: '40000000-0000-0000-0000-000000000005',
  ROLE_GLOBEX_LEARNER: '40000000-0000-0000-0000-000000000006',

  // Learning Resources
  RES_ACME_COURSE1: '50000000-0000-0000-0000-000000000001',
  RES_ACME_COURSE2: '50000000-0000-0000-0000-000000000002',
  RES_GLOBEX_COURSE1: '50000000-0000-0000-0000-000000000003',
  RES_ACME_ASSIGNMENT1: '50000000-0000-0000-0000-000000000004',

  // Teaching Assignments
  TEACH_BOB_COURSE1: '60000000-0000-0000-0000-000000000001',
  TEACH_ALICE_GLOBEX_COURSE1: '60000000-0000-0000-0000-000000000002',
};

const SEED_SQL = `
-- ============================================================
-- Organizations
-- ============================================================
INSERT INTO organizations (id, name, slug, status) VALUES
  ('${IDS.ORG_ACME}', 'Acme Learning Corp', 'acme', 'active'),
  ('${IDS.ORG_GLOBEX}', 'Globex University', 'globex', 'active');

-- ============================================================
-- Users (global, not org-specific)
-- ============================================================
INSERT INTO users (id, display_name) VALUES
  ('${IDS.USER_ALICE}', 'Alice Johnson'),
  ('${IDS.USER_BOB}', 'Bob Smith'),
  ('${IDS.USER_CHARLIE}', 'Charlie Davis'),
  ('${IDS.USER_DIANA}', 'Diana Martinez'),
  ('${IDS.USER_EVE}', 'Eve Wilson');

-- ============================================================
-- Authentication Identities (linked to Keycloak)
-- issuer and subject match fixed IDs in the imported synthetic realm.
-- ============================================================
INSERT INTO authentication_identities (user_id, issuer, subject, email, email_verified) VALUES
  ('${IDS.USER_ALICE}', 'http://localhost:8180/realms/iam-platform', '70000000-0000-0000-0000-000000000001', 'alice@example.com', true),
  ('${IDS.USER_BOB}', 'http://localhost:8180/realms/iam-platform', '70000000-0000-0000-0000-000000000002', 'bob@example.com', true),
  ('${IDS.USER_CHARLIE}', 'http://localhost:8180/realms/iam-platform', '70000000-0000-0000-0000-000000000003', 'charlie@example.com', true),
  ('${IDS.USER_DIANA}', 'http://localhost:8180/realms/iam-platform', '70000000-0000-0000-0000-000000000004', 'diana@example.com', true),
  ('${IDS.USER_EVE}', 'http://localhost:8180/realms/iam-platform', '70000000-0000-0000-0000-000000000005', 'eve@example.com', true);

-- ============================================================
-- Roles (organization-scoped, system roles)
-- ============================================================
INSERT INTO roles (id, organization_id, name, description, is_system_role) VALUES
  ('${IDS.ROLE_ACME_ADMIN}', '${IDS.ORG_ACME}', 'admin', 'Organization administrator', true),
  ('${IDS.ROLE_ACME_INSTRUCTOR}', '${IDS.ORG_ACME}', 'instructor', 'Course instructor', true),
  ('${IDS.ROLE_ACME_LEARNER}', '${IDS.ORG_ACME}', 'learner', 'Student/learner', true),
  ('${IDS.ROLE_GLOBEX_ADMIN}', '${IDS.ORG_GLOBEX}', 'admin', 'Organization administrator', true),
  ('${IDS.ROLE_GLOBEX_INSTRUCTOR}', '${IDS.ORG_GLOBEX}', 'instructor', 'Course instructor', true),
  ('${IDS.ROLE_GLOBEX_LEARNER}', '${IDS.ORG_GLOBEX}', 'learner', 'Student/learner', true);

-- ============================================================
-- Memberships
-- Alice: admin in Acme, learner in Globex (multi-org user)
-- Bob: instructor in Acme
-- Charlie: learner in Acme
-- Diana: admin + instructor in Globex
-- Eve: inactive learner in Acme (for denial tests)
-- ============================================================
INSERT INTO memberships (id, user_id, organization_id, status) VALUES
  ('${IDS.MEM_ALICE_ACME}', '${IDS.USER_ALICE}', '${IDS.ORG_ACME}', 'active'),
  ('${IDS.MEM_ALICE_GLOBEX}', '${IDS.USER_ALICE}', '${IDS.ORG_GLOBEX}', 'active'),
  ('${IDS.MEM_BOB_ACME}', '${IDS.USER_BOB}', '${IDS.ORG_ACME}', 'active'),
  ('${IDS.MEM_CHARLIE_ACME}', '${IDS.USER_CHARLIE}', '${IDS.ORG_ACME}', 'active'),
  ('${IDS.MEM_DIANA_GLOBEX}', '${IDS.USER_DIANA}', '${IDS.ORG_GLOBEX}', 'active'),
  ('${IDS.MEM_EVE_ACME}', '${IDS.USER_EVE}', '${IDS.ORG_ACME}', 'inactive');

-- ============================================================
-- Membership Roles
-- ============================================================
INSERT INTO membership_roles (membership_id, role_id) VALUES
  ('${IDS.MEM_ALICE_ACME}', '${IDS.ROLE_ACME_ADMIN}'),
  ('${IDS.MEM_ALICE_GLOBEX}', '${IDS.ROLE_GLOBEX_LEARNER}'),
  ('${IDS.MEM_BOB_ACME}', '${IDS.ROLE_ACME_INSTRUCTOR}'),
  ('${IDS.MEM_CHARLIE_ACME}', '${IDS.ROLE_ACME_LEARNER}'),
  ('${IDS.MEM_DIANA_GLOBEX}', '${IDS.ROLE_GLOBEX_ADMIN}'),
  ('${IDS.MEM_DIANA_GLOBEX}', '${IDS.ROLE_GLOBEX_INSTRUCTOR}'),
  ('${IDS.MEM_EVE_ACME}', '${IDS.ROLE_ACME_LEARNER}');

-- ============================================================
-- Learning Resources
-- ============================================================
INSERT INTO learning_resources (id, organization_id, title, description, resource_type, status, created_by) VALUES
  ('${IDS.RES_ACME_COURSE1}', '${IDS.ORG_ACME}', 'Introduction to TypeScript', 'Learn TypeScript fundamentals', 'course', 'published', '${IDS.USER_BOB}'),
  ('${IDS.RES_ACME_COURSE2}', '${IDS.ORG_ACME}', 'Advanced Node.js', 'Deep dive into Node.js patterns', 'course', 'published', '${IDS.USER_BOB}'),
  ('${IDS.RES_GLOBEX_COURSE1}', '${IDS.ORG_GLOBEX}', 'Data Science 101', 'Introduction to data science', 'course', 'published', '${IDS.USER_DIANA}'),
  ('${IDS.RES_ACME_ASSIGNMENT1}', '${IDS.ORG_ACME}', 'TypeScript Project 1', 'Build a CLI tool', 'assignment', 'published', '${IDS.USER_BOB}');

-- ============================================================
-- Teaching Assignments
-- Bob teaches Acme Course 1 and its assignment
-- Alice teaches Globex Course 1 (she is a learner there, but also teaches)
-- ============================================================
INSERT INTO teaching_assignments (id, user_id, organization_id, resource_id, role) VALUES
  ('${IDS.TEACH_BOB_COURSE1}', '${IDS.USER_BOB}', '${IDS.ORG_ACME}', '${IDS.RES_ACME_COURSE1}', 'instructor'),
  ('${IDS.TEACH_ALICE_GLOBEX_COURSE1}', '${IDS.USER_ALICE}', '${IDS.ORG_GLOBEX}', '${IDS.RES_GLOBEX_COURSE1}', 'instructor');

-- ============================================================
-- Consents
-- ============================================================
INSERT INTO consents (user_id, organization_id, purpose, granted) VALUES
  ('${IDS.USER_ALICE}', '${IDS.ORG_ACME}', 'analytics', false),
  ('${IDS.USER_ALICE}', '${IDS.ORG_GLOBEX}', 'analytics', false),
  ('${IDS.USER_BOB}', '${IDS.ORG_ACME}', 'analytics', false),
  ('${IDS.USER_CHARLIE}', '${IDS.ORG_ACME}', 'analytics', false);

-- ============================================================
-- Profiles (org-scoped)
-- ============================================================
INSERT INTO profiles (user_id, organization_id, display_name, bio) VALUES
  ('${IDS.USER_ALICE}', '${IDS.ORG_ACME}', 'Alice J.', 'Platform admin at Acme'),
  ('${IDS.USER_ALICE}', '${IDS.ORG_GLOBEX}', 'Alice Johnson', 'Learning data science'),
  ('${IDS.USER_BOB}', '${IDS.ORG_ACME}', 'Prof. Bob', 'TypeScript instructor'),
  ('${IDS.USER_CHARLIE}', '${IDS.ORG_ACME}', 'Charlie D.', 'Student'),
  ('${IDS.USER_DIANA}', '${IDS.ORG_GLOBEX}', 'Dr. Diana', 'Dean and DS professor');
`;

async function seed() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('Connected to database. Running seed...');
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('iam-demo-seed'))");
    // Never reseed an existing demonstration tenant: role removals, grades,
    // consent withdrawals, and suspension survive ordinary container restarts.
    const existing = await client.query('SELECT id FROM organizations WHERE id = $1',[IDS.ORG_ACME]);
    if (!existing.rowCount) await client.query(SEED_SQL);
    await client.query(`INSERT INTO learning_resources (id,organization_id,title,resource_type,status,created_by)
      VALUES ('50000000-0000-0000-0000-000000000005',$1,'Unpublished synthetic course','course','draft',$2)
      ON CONFLICT (id) DO NOTHING`,[IDS.ORG_ACME,IDS.USER_BOB]);
    await client.query(`INSERT INTO submissions (id,organization_id,course_id,user_id,content)
      VALUES ('80000000-0000-0000-0000-000000000001',$1,$2,$3,'Synthetic course submission'),
      ('80000000-0000-0000-0000-000000000002',$1,$4,$3,'Synthetic unrelated-course submission')
      ON CONFLICT (id) DO NOTHING`,[IDS.ORG_ACME,IDS.RES_ACME_COURSE1,IDS.USER_CHARLIE,IDS.RES_ACME_COURSE2]);
    await client.query('COMMIT');
    console.log('Seed data inserted successfully.');
    console.log('');
    console.log('Synthetic test data summary:');
    console.log('  Organizations: Acme Learning Corp (acme), Globex University (globex)');
    console.log('  Users: Alice (admin@acme, learner@globex), Bob (instructor@acme),');
    console.log('         Charlie (learner@acme), Diana (admin+instructor@globex),');
    console.log('         Eve (inactive learner@acme)');
    console.log('  Resources: 3 courses + 1 assignment across 2 orgs');
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();

export { IDS };
