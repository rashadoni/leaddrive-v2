# Benchmarking the social-relevance decision (Jev replay)

## Why

"Is this record about our brand" is the weakest decision in social monitoring.
The string matcher's largest rejection class is `no_monitoring_subject_match`:
the platform found the record by a word, the brand is not in the text, and the
record is already paid for. The Haiku judge written for it (#646) **has never
run in production** — on 2026-09-27 there was not a single stored verdict in
`social_mention_subject_matches.contextSignals`.

Jev (TypeSafe AI, early access since 2026-09-15) answers exactly this shape of
question: a fixed set of labels in, one label plus a calibrated confidence out,
no free text. Before it goes anywhere near the product it has to be measured on
our own records, and that is all this benchmark does.

## What it is not

`scripts/ai/jev-relevance-replay.ts` writes nothing to the CRM, calls no
production route, and changes no stored decision. It reads a corpus file and
writes a report beside it.

## The corpus

Exported read-only from production. Each row is one
`social_mention_subject_matches` row joined to its mention, the mention's parent
publication and the monitored subject:

```sql
select set_config('app.rls_bypass','on',false);
copy (
  select replace(encode(convert_to(row_json,'UTF8'),'base64'), chr(10), '') from (
  select (jsonb_build_object(
    'matchId', m.id, 'mentionId', sm.id, 'organizationId', m."organizationId",
    'subjectId', s.id, 'subjectName', s.name, 'subjectType', s.type,
    'requiredContext', s."requiredContext", 'exclusions', s.exclusions,
    'aliases', coalesce((select jsonb_agg(a.value order by a.value) from monitoring_subject_aliases a
       where a."subjectId" = s.id and a."organizationId" = s."organizationId" and a."isNegative" = false), '[]'::jsonb),
    'negativeAliases', coalesce((select jsonb_agg(a.value order by a.value) from monitoring_subject_aliases a
       where a."subjectId" = s.id and a."organizationId" = s."organizationId" and a."isNegative" = true), '[]'::jsonb),
    'platform', sm.platform, 'contentKind', sm."contentKind", 'matchedTerm', sm."matchedTerm",
    'authorName', sm."authorName", 'authorHandle', sm."authorHandle",
    'text', left(coalesce(sm.text,''), 1500),
    'parentText', left(coalesce(pm.text,''), 900),
    'publishedAt', sm."publishedAt", 'status', m.status, 'signals', m."contextSignals"
  ))::text as row_json
  from social_mention_subject_matches m
  join social_mentions sm on sm.id = m."mentionId" and sm."organizationId" = m."organizationId"
  join monitoring_subjects s on s.id = m."subjectId" and s."organizationId" = m."organizationId"
  left join social_mentions pm on pm.id = coalesce(m."contextSignals"->>'parentMentionId', sm."parentExternalId")
    and pm."organizationId" = m."organizationId"
  where coalesce(sm.text,'') <> ''
  order by m."createdAt" desc
) q(row_json)
) to stdout;
```

base64 per row because `COPY` escaping mangles JSON that contains quotes and
newlines — the first export produced unparseable lines.

**The corpus holds customer text. It stays in a scratch directory and is never
committed.** Personal data is masked with the product's own `PiiMasker` before
anything leaves the machine, exactly as the Haiku judge does it.

Shape on 2026-09-27: 2204 rows, 6 monitored subjects, 1 organisation;
1371 MATCHED / 838 REJECTED; 917 rows have a parent publication, and 801 name
the brand nowhere in their own text.

## What counts as truth

The matcher's own decision is **not** truth — it is the thing under test. The
script separates:

- **literal** — the brand or an alias appears in the record's own text (1055
  rows). A disagreement here is a real model error.
- **excluded** — a negative alias or exclusion term appears and no positive one
  does. Empty today: these six subjects have no exclusions configured.
- **unknown** — neither (1149 rows), including the `ambiguousOnly` class the
  judge was built for. Nothing automatic can score these, so they go into a
  hand-labelling sheet instead of a percentage.

## Running it

```bash
# validates the corpus and prints the first request, sends nothing
npx tsx scripts/ai/jev-relevance-replay.ts --dry-run --corpus "$TMPDIR/jev-corpus.jsonl"

# the real run; ~400 input tokens per record, so the whole corpus is ~$0.04
TYPESAFE_API_KEY=… npx tsx scripts/ai/jev-relevance-replay.ts \
  --corpus "$TMPDIR/jev-corpus.jsonl" --out "$TMPDIR/jev-replay"
```

`tsx` needs a short `TMPDIR` (its IPC socket path has a 104-character limit), so
on this host prefix the command with `TMPDIR=~/.cache/jev-tmp` and pass the
corpus path explicitly.

Outputs: `-results.jsonl`, `-report.md` (agreement per reference class, a
confidence-calibration table, the cross-tab against the matcher) and
`-labels.md` (up to 60 records for a human to settle).

## What the result may and may not decide

A good score does not put Jev in the product. It buys one narrow change: a
second opinion on records the matcher already rejected, where a confident
`about_subject` restores the record and anything else leaves it rejected — the
direction the Haiku judge pass already established, because the cost of a wrong
restore is noise in a client's feed and the cost of a wrong rejection is a lost
complaint. Adding TypeSafe as a subprocessor is a separate decision, and the
missing DPA is part of it.
