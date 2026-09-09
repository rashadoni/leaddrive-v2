/**
 * Minimal metadata required to resolve an attached object. Reuse this exact
 * selection at every private reader so an object-backed row never falls
 * through to its legacy filesystem `storageKey`.
 */
export const mtmMediaObjectStorageSelect = {
  id: true,
  organizationId: true,
  kind: true,
  state: true,
  provider: true,
  bucketName: true,
  objectKey: true,
  checksumSha256: true,
  sizeBytes: true,
  mimeType: true,
  encryptionKeyId: true,
  retentionUntil: true,
  legalHold: true,
  photoId: true,
  documentId: true,
} as const
