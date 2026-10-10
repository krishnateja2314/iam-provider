# Domain Model

## Scope and Sources of Truth

This describes the PostgreSQL application schema in `backend/src/db/migrations/001-initial.ts` and `002-boundaries.ts`, with Kysely types in `schema.ts`. Keycloak 26.8.0 has a **separate** database containing provider users, credentials, broker links and sessions. Those provider tables are not application tables in the diagram below.

A platform user is global. An organization is a tenant. Membership connects the two; roles belong to an organization and are assigned to a membership, not globally to a user. The same person can be an admin in one organization and a learner in another.

## Entity Relationships

```mermaid
erDiagram
    USERS ||--o{ AUTHENTICATION_IDENTITIES : authenticates_as
    USERS ||--o{ MEMBERSHIPS : joins
    ORGANIZATIONS ||--o{ MEMBERSHIPS : contains
    ORGANIZATIONS ||--o{ ROLES : defines
    MEMBERSHIPS ||--o{ MEMBERSHIP_ROLES : has
    ROLES ||--o{ MEMBERSHIP_ROLES : assigned_as
    USERS ||--o{ PROFILES : has
    ORGANIZATIONS ||--o{ PROFILES : scopes
    ORGANIZATIONS ||--o{ LEARNING_RESOURCES : owns
    MEMBERSHIPS ||--o{ TEACHING_ASSIGNMENTS : teaches
    LEARNING_RESOURCES ||--o{ TEACHING_ASSIGNMENTS : assigned
    MEMBERSHIPS ||--o{ SUBMISSIONS : submits
    LEARNING_RESOURCES ||--o{ SUBMISSIONS : receives
    USERS ||--o{ CONSENTS : records
    ORGANIZATIONS o|--o{ CONSENTS : scopes
    ORGANIZATIONS ||--o{ POLICY_RULES : configures
    USERS ||--o{ PROVISIONING_REQUESTS : retries_as_actor
    ORGANIZATIONS ||--o{ PROVISIONING_REQUESTS : result
    MEMBERSHIPS ||--o{ PROVISIONING_REQUESTS : bootstrap_result
    USERS {
        uuid id PK
        varchar display_name
    }
    AUTHENTICATION_IDENTITIES {
        uuid id PK
        uuid user_id FK
        varchar issuer UK
        varchar subject UK
        varchar email
        boolean email_verified
        jsonb provider_metadata
    }
    ORGANIZATIONS {
        uuid id PK
        varchar slug UK
        varchar status
        integer max_members
        integer max_resources
    }
    MEMBERSHIPS {
        uuid id PK
        uuid user_id FK
        uuid organization_id FK
        varchar status
    }
    ROLES {
        uuid id PK
        uuid organization_id FK
        varchar name
    }
    MEMBERSHIP_ROLES {
        uuid id PK
        uuid membership_id FK
        uuid role_id FK
        uuid organization_id FK
    }
    PROFILES {
        uuid id PK
        uuid user_id FK
        uuid organization_id FK
        varchar display_name
        text bio
    }
    LEARNING_RESOURCES {
        uuid id PK
        uuid organization_id FK
        varchar resource_type
        varchar status
        uuid created_by FK
    }
    TEACHING_ASSIGNMENTS {
        uuid id PK
        uuid user_id FK
        uuid organization_id FK
        uuid resource_id FK
        varchar role
    }
    SUBMISSIONS {
        uuid id PK
        uuid course_id FK
        uuid organization_id FK
        uuid user_id FK
        text content
        numeric grade
    }
    CONSENTS {
        uuid id PK
        bigint sequence
        uuid user_id FK
        uuid organization_id FK
        varchar purpose
        boolean granted
        timestamptz revoked_at
    }
    POLICY_RULES {
        uuid id PK
        uuid organization_id FK
        varchar role_name
        varchar resource
        varchar action
        varchar effect
    }
    PROVISIONING_REQUESTS {
        uuid actor_id PK,FK
        varchar idempotency_key PK
        text payload_hash
        uuid organization_id FK
        uuid membership_id FK
    }
    AUDIT_EVENTS {
        uuid id PK
        uuid actor_id
        uuid subject_id
        uuid organization_id
        varchar action
        varchar decision
        uuid correlation_id
        jsonb metadata
    }
    SCHEMA_MIGRATIONS {
        integer version PK
        text checksum
        timestamptz applied_at
    }
```

`UK` on issuer/subject denotes the **combined** unique key, not individual uniqueness. Other combined constraints are listed below. The teaching/submission membership edges are composite `(user_id, organization_id)` references. Audit identifiers deliberately are not FK-enforced relationships; an audit event may describe a denied, absent or historical subject.

## Tables and Important Constraints

| Table | Meaning and Database Guarantees |
|---|---|
| `users` | Global internal identity, display name, timestamps. No tenant column and no password column. |
| `authentication_identities` | FK to user; `UNIQUE(issuer, subject)`. Email is optional metadata, verification is a boolean, provider metadata is nullable JSONB. No email unique key or automatic email-based linking. |
| `organizations` | Unique slug; status `active`, `suspended`, or `archived`; positive member/resource quotas, each default 1000. |
| `memberships` | `UNIQUE(user_id, organization_id)`; status `active`, `inactive`, or `suspended`; additional `(id, organization_id)` unique target for composite references. |
| `roles` | `UNIQUE(organization_id, name)` and `(id, organization_id)`; system-role flag is metadata. Bootstrap creates admin, instructor and learner. |
| `membership_roles` | Unique membership/role pair; composite FKs bind both referenced rows to the stored organization. A trigger derives organization for inserts that omit it. Changing a referenced parent's tenant cannot silently break the relationship. |
| `profiles` | `UNIQUE(user_id, organization_id)`; display name and optional bio. Separate user/org FKs, not a composite FK to membership; the privacy service requires active memberships before sharing. |
| `learning_resources` | Tenant FK; type `course`, `module`, `lesson`, `assignment`; status `draft`, `published`, `archived`; optional creator. Additional `(id, organization_id)` unique reference target. |
| `teaching_assignments` | Unique user/resource pair; role `instructor`, `assistant`, `grader`; composite FKs to tenant membership and tenant resource plus the original same-org trigger. Stored teaching-role labels are not independent Casbin permissions. |
| `submissions` | Composite FKs to tenant resource and tenant member; content and nullable numeric grade constrained to 0..100. Database does not require the referenced resource's `resource_type` to be `course`; the name alone is not such a guarantee. API accepts integer grades. |
| `consents` | Purpose-specific history; generated sequence orders latest decisions. Update/delete trigger enforces append-only normal writes, but allows nested cascade deletion. New rows are constrained to `profile-sharing` or `analytics`; the migration uses `NOT VALID`, so it does not certify old legacy purposes. Organization may be null in schema; current service writes tenant-scoped records. |
| `policy_rules` | Unique `(organization_id, role_name, resource, action, effect)`; effect constrained to allow/deny. Role name is text, not an FK to roles. Public route adds stricter enums. |
| `provisioning_requests` | PK `(actor_id, idempotency_key)`; payload hash and successful organization/bootstrap membership references. Ledger is committed with the organization; it is not a record of all failed attempts. |
| `audit_events` | Time, actor/subject/tenant, action/resource, allow/deny/error, internal reason, correlation ID, IP and metadata. Query indexes; no cryptographic chaining or append-only DB trigger. |
| `schema_migrations` | Version/checksum ledger created by runner; serialized migration execution and checksum checks. Not a business entity. |

## Transactional Behavior

First-login creation takes a transaction advisory lock for `(issuer, subject)`, rereads identity, and commits user and external link together. Uniqueness remains the final database protection. Email verification defaults false unless the validated provider claim is exactly true; an existing identity is returned rather than resynchronized on every login.

Provisioning takes an actor/key advisory lock, compares a normalized payload hash, and atomically creates organization, default roles, initial admin membership/assignment/profile, retry ledger and audit. Same actor/key and same payload returns the existing result; changed payload conflicts. A key is not globally shared across actors.

Member/resource insertion quota triggers lock the organization row and count **all** rows in the tenant, including inactive members or archived resources. They also check moves into a different tenant. Member creation additionally checks count in its transaction. This avoids two concurrent insertions both consuming the last slot. Quotas do not currently describe billing, storage bytes, API rates, or active-user-only limits.

Consent inserts and audit commit together. Sharing uses a repeatable-read transaction, checks caller and target membership, and considers only the latest same-user/same-tenant/same-purpose decision. `analytics` consent never enables profile bio sharing.

## Provider Session Boundary

There is **no local session or device table** in the application schema. `sid`/`session_state` is validated and carried as `AuthenticatedUser.providerSessionId` in request memory. Keycloak persists the provider sessions; the session API obtains their references from Keycloak. `provider_metadata` exists on external identities but is not evidence of session/device persistence and is not populated with a device attestation by current first-login creation.

A provider session identifies a login session, not a physically verified device. IP address and client IDs are useful context, not hardware attestation. No native device registration, secure-hardware proof, or local session ledger is implemented.
