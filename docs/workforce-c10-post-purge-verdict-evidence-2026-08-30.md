# Workforce C10 post-purge verdict evidence

Raw attendance ciphertext and exact coordinates have a shorter lifecycle than
the derived attendance decision. The normal assessment report projects the
immutable geofence verdict, reason code, assessor version, effective geofence
reference and timestamps, plus only a redacted evidence reference and purge
timestamp. It never selects the encrypted envelope or exact coordinates.

The post-purge fixture proves that an `INSIDE` verdict remains reportable after
`rawEnvelopeCiphertext` is cleared and `rawPurgedAt` is set, while serialized
report data and the Prisma selection contain no latitude, longitude, known raw
coordinate values, or ciphertext field.
