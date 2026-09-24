-- Soulbound's own hosted-mode tables (spec: API and Type Contracts -> DB).
--
-- invites: single-use sign-up codes. Only the SHA-256 of a code is stored
--   (code_hash). reserved_until / reserved_nonce / reserved_email hold the
--   `user.create.before` hook's short reservation; used_by / used_at record
--   consumption. reserved_email is the plan-critique addition (spec Revision
--   History row 21): the purge's reconciliation joins on it. Deleting a user
--   keeps the consumed invite (used_by becomes NULL; used_at stays set).
--
-- account_deletions: the 7-day deletion grace period. One row per pending
--   deletion; deleting the user (the purge) cascades it away.
--
-- "user"(id) is text: that is the type Better Auth generated in 001.

-- Up Migration
CREATE TABLE "invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code_hash" bytea NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT now() + interval '14 days',
  "reserved_until" timestamptz,
  "reserved_nonce" bytea,
  "reserved_email" text,
  "used_by" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "used_at" timestamptz
);

CREATE TABLE "account_deletions" (
  "user_id" text PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  "requested_at" timestamptz NOT NULL
);

-- Down Migration
DROP TABLE "account_deletions";
DROP TABLE "invites";
