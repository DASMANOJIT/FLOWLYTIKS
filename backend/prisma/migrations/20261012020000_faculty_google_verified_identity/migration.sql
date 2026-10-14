ALTER TABLE "FacultyGoogleConnection"
  ADD COLUMN "googleSubject" TEXT,
  ADD COLUMN "identityVerifiedAt" TIMESTAMP(3);
ALTER TABLE "FacultyGoogleOAuthState" ADD COLUMN "oidcNonceHash" TEXT;
