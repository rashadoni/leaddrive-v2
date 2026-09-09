# Credential handling for the legacy snapshot

This directory is retained only as input to the controlled v1-to-v2 migration.
It must not be used as a credential backup or secret-transfer mechanism.

Credential-bearing fields in the tracked snapshot are deliberately `null`:

- password hashes and TOTP/calendar capability material;
- SMTP passwords;
- channel bot tokens, API keys, webhook URLs, and active flags.

`scripts/import-v1.ts` independently ignores legacy user credentials and creates
those principals disabled with fresh random hashes. It also imports channel
identities disabled and without secrets or webhook URLs. Operators must configure
fresh credentials through the approved secret/configuration path after import.

Because prior Git history may retain removed values, rotate the affected user,
calendar, SMTP, and channel credentials before treating the migration as closed.
