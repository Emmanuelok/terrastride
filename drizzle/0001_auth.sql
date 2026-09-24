-- Better Auth 1.7.5 core schema with database-backed sessions and rate limits.
CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId" ON "session"("userId");
CREATE INDEX "session_expiresAt" ON "session"("expiresAt");
CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT,
  "accessTokenExpiresAt" INTEGER, "refreshTokenExpiresAt" INTEGER,
  "scope" TEXT, "password" TEXT,
  "createdAt" INTEGER NOT NULL, "updatedAt" INTEGER NOT NULL
);
CREATE INDEX "account_userId" ON "account"("userId");
CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "verification_identifier" ON "verification"("identifier");
CREATE INDEX "verification_expiresAt" ON "verification"("expiresAt");
CREATE TABLE "rateLimit" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" INTEGER NOT NULL
);
CREATE TABLE "auth_throttle" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "count" INTEGER NOT NULL,
  "expires" INTEGER NOT NULL
);
CREATE INDEX "auth_throttle_expires" ON "auth_throttle"("expires");
-- A guest token may be claimed once, by one account, even across concurrent tabs.
CREATE TABLE "auth_guest_claims" (
  "guest" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "claim" TEXT NOT NULL UNIQUE,
  "created" INTEGER NOT NULL
);
