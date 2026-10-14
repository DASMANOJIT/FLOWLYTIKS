CREATE TABLE "FacultyGoogleConnection" (
  "facultyId" TEXT NOT NULL,
  "accessTokenEncrypted" TEXT,
  "refreshTokenEncrypted" TEXT,
  "expiresAt" TIMESTAMP(3),
  "scope" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacultyGoogleConnection_pkey" PRIMARY KEY ("facultyId")
);
CREATE TABLE "FacultyGoogleOAuthState" (
  "id" TEXT NOT NULL,
  "facultyId" TEXT NOT NULL,
  "launchTokenHash" TEXT NOT NULL,
  "stateHash" TEXT,
  "browserNonceHash" TEXT,
  "codeVerifierEncrypted" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "launchedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FacultyGoogleOAuthState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FacultyGoogleOAuthState_launchTokenHash_key" ON "FacultyGoogleOAuthState"("launchTokenHash");
CREATE UNIQUE INDEX "FacultyGoogleOAuthState_stateHash_key" ON "FacultyGoogleOAuthState"("stateHash");
CREATE INDEX "FacultyGoogleOAuthState_facultyId_idx" ON "FacultyGoogleOAuthState"("facultyId");
CREATE INDEX "FacultyGoogleOAuthState_expiresAt_idx" ON "FacultyGoogleOAuthState"("expiresAt");
ALTER TABLE "FacultyGoogleConnection" ADD CONSTRAINT "FacultyGoogleConnection_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FacultyGoogleOAuthState" ADD CONSTRAINT "FacultyGoogleOAuthState_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
