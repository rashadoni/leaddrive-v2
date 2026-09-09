# Social Monitoring — 48–72 hour production soak log

This is an evidence log, not a claim that the soak has passed. Start a new
entry only after a successful production deployment and an owner confirms the
seven-subject scope and smoke credentials.

## Start gate

- Deployment workflow:
- Live SHA:
- Started at (UTC):
- Owner:
- Subject/source scope:
- Authenticated smoke run:

## Checkpoints

| UTC checkpoint | Sources healthy | Successful runs | Failed/partial runs | Duplicates | p95 latency | Provider cost | Restarts | Critical auth/provider errors | Reviewer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| T+0 | | | | | | | | | |
| T+12h | | | | | | | | | |
| T+24h | | | | | | | | | | |
| T+36h | | | | | | | | | | |
| T+48h | | | | | | | | | | |
| T+60h | | | | | | | | | | |
| T+72h | | | | | | | | | | |

## Pass criteria

- No critical collector or authentication error.
- No hidden paid provider dispatch and no budget overrun.
- Every enabled source has a successful run inside its agreed cadence.
- Alert SLOs remain actionable and deduplicated.
- Duplicate, latency, restart, and provider-cost evidence is complete.

Do not mark the production-readiness checkbox until all checkpoints and an
owner sign-off are recorded.
