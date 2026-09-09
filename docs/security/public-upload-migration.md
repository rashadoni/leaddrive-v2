# Public upload migration

The upload proxy permits anonymous reads only for newly hardened immutable
raster outputs with these exact shapes:

- `/uploads/email-images/<organizationId>/img-<32 lowercase hex>.(png|jpg|webp)`
- `/uploads/logos/logo-<32 lowercase hex>.(png|jpg|webp)`

All other runtime uploads, including legacy email images and tenant logos,
continue to require a valid browser session. Private directories such as
`contracts`, `inbox`, `whatsapp`, `telegram`, `mtm-photos`, `mtm-invoices`,
`tasks`, `avatars`, and `social-logos` must never be made anonymous.

Before production rollout, inventory existing database and branding references
under `/uploads/email-images/` and `/uploads/logos/`. Older files used shorter
names and may contain raw, spoofed, animated, or active-content bytes. Do not
make them public by renaming or blindly copying them into the persistent volume.
For each still-referenced image:

1. Decode it with the hardened raster pipeline and reject invalid, SVG, GIF,
   multi-page, oversized, or active-content/polyglot input.
2. Re-encode it to a static PNG, JPEG, or WebP with a new 32-hex canonical name.
3. Update the owning template or tenant branding reference transactionally.
4. Verify the new URL through the upload proxy, then quarantine the old file.

The deploy script creates persistent symlinks for every directory in
`PROXIED_UPLOAD_SUBDIRS`. A static test keeps that shell list synchronized with
the application allowlist. Migration and removal of legacy bytes remain an
explicit operator step; deployment does not delete or silently publish them.

Routing is part of the same security boundary. Nginx must not use a filesystem
alias for `/uploads/`, and `next.config.ts` must keep the upload rewrite in
`beforeFiles`. Next.js array-form rewrites run after public-file lookup, which
would let a real file bypass the API route. The deploy-parity regression test
also pins this ordering.
