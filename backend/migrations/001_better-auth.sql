-- Better Auth's schema: the user, session, account and verification tables.
--
-- GENERATED, not hand-written. The up section below is the verbatim output of
-- the Better Auth CLI, pinned to the exact better-auth version in
-- backend/package.json (never @latest, so the schema matches the runtime
-- library):
--
--   npx -y auth@1.7.6 generate --config ./auth.ts --output ./001.sql --yes
--
-- run against an empty Postgres 16 database, with a throwaway auth.ts that
-- enabled everything 06-03 uses: the magicLink plugin, and the google and
-- discord social providers (telemetry disabled). Neither the plugin nor the
-- providers add columns to the core tables in this version.
--
-- The `auth` package on npm is Better Auth's CLI (same repository; auth@1.7.6
-- depends on better-auth 1.7.6 exactly), and the installed library itself
-- points at it (node_modules/better-auth/dist/context/create-context.mjs:44).
--
-- The reverse section at the bottom is hand-written: it drops the tables in
-- reverse foreign-key order (the indexes go with their tables).
--
-- When better-auth is upgraded, regenerate with the new pinned version and add
-- the difference as a NEW migration; never edit this file once applied.

-- Up Migration
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

-- Down Migration
DROP TABLE "verification";
DROP TABLE "account";
DROP TABLE "session";
DROP TABLE "user";
