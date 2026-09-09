-- Reconcile Prisma's defining-side metadata for the tenant-scoped one-to-one
-- media relations. The existing single-column unique keys remain in force;
-- these composite keys make the composite foreign-key relation cardinality
-- explicit without changing rows, RLS, retention, or v1 media authority.
SET lock_timeout = '3s';

CREATE UNIQUE INDEX IF NOT EXISTS "mtm_media_objects_organizationId_photoId_key"
  ON "mtm_media_objects"("organizationId", "photoId");

CREATE UNIQUE INDEX IF NOT EXISTS "mtm_media_objects_organizationId_documentId_key"
  ON "mtm_media_objects"("organizationId", "documentId");
