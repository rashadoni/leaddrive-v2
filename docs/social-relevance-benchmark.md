# Benchmarking the social-relevance decision (Jev replay)

## Why

"Is this record about our brand" is the weakest decision in social monitoring.
The string matcher's largest rejection class is `no_monitoring_subject_match`:
the platform found the record by a word, the brand is not in the text, and the
record is already paid for. The Haiku judge written for it (#646) has run on **91
records** — the stamp is `contextSignals.aiJudgeVerdict`, not the
`aiRelevanceJudge` key the ingest path writes, which is why a first pass over
the table appeared to find nothing.

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
    'geographies', s.geographies, 'languages', s.languages,
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

## Results — 2026-09-27

Two full passes over 2204 records, $0.066 and $0.069 (plus a $0.006 trial). 9 of
2204 calls failed on the first pass (3 × HTTP 529 "system_overloaded", 6
timeouts) and none on the second — a retry is worth having before this is ever
put in a cron.

### The confidence number is the useful part

Agreement with the literal reference, by confidence bucket (second pass):

| confidence | records | agrees |
| --- | --- | --- |
| 0.90–1.00 | 770 | 99% |
| 0.70–0.90 | 111 | 72% |
| 0.50–0.70 | 77 | 70% |
| 0.00–0.50 | 97 | 53% |

Below 0.7 the answer is a coin flip; at 0.9 and above it is as good as the hard
evidence. None of our current classifiers expose anything like this, and it is
what makes a "restore only when sure" rule possible at all.

### Against the Haiku judge

On the 91 records the Haiku judge has decided, Jev agrees with it on **81%**,
and on **94%** of the subset where Jev's own confidence is ≥ 0.9. Small sample,
and the Haiku verdicts are not truth either — but the two models mostly see the
same thing, and they diverge where Jev is unsure.

### What it would recover

349 rejected records come back as a confident `about_subject`. **175 of them are
the brand's own posts**, which the pipeline rejects by policy, not by mistake —
so the honest figure is **174 records**, and they read like the thing the judge
was built for:

> halal olsun Araz markete · mən həmişə Arazdan alver edirəm · Araz şebekesi çox
> iş iscilerin…

### A defect of ours, not of the model

Monitored subjects carry `geographies` and `languages` (`Azərbaycan`, `az,ru`),
and **neither the Haiku judge nor the first version of this harness told the
model about them**. Without that, a Bravo Supermarket in Florida, a Bravo
Süpermarket in Adana and an Oba Market in Bonn or Lagos are indistinguishable
from the monitored chains — and the model said `about_subject` at 0.99 on
exactly those records.

Adding the two fields changed **114 verdicts**, and the samples read correct in
both directions: the Florida/Adana/Bonn/Lagos records flipped to
`not_about_subject`, and genuine Azerbaijani comments flipped the other way.
One of the Turkish records is `MATCHED` today, i.e. that noise is in a client's
feed right now. **This is worth fixing in `ai-relevance-judge.ts` regardless of
whether Jev is ever adopted.**

Note the side effect on the metric above: the "brand is literally in the text"
reference is wrong for these same-name records, so the literal agreement fell
from 94% to 90% while the answers got better. A reference that cannot tell two
shops with one name apart is the limit of what can be measured without hand
labels.

### What this does not settle

The 149 records where Jev says `not_about_subject` about something the matcher
MATCHED are **not** grounds for deleting anything: the confident ones include a
customer complaining about a phone they bought, which is exactly the record a
client must not lose. The plus-only direction the judge pass already uses stays
right.

Adding TypeSafe as a subprocessor is still a separate decision, and the missing
DPA is part of it.

## Wired, 2026-09-28

Owner decision: "Jev wherever it copes", with two limits named out loud — it
may not answer, and it cannot read photographs. Both are properties of the
code now, not hopes:

- `src/lib/social/jev-relevance-judge.ts` never throws. Overload (`529`) and
  timeouts are retried exactly once and then reported as no answer; a rejected
  request is not repeated. The judge only ever adds a second signal, so a
  silent provider leaves the record exactly as it was and it is looked at again
  on the next pass.
- A record whose **own** text carries fewer than 12 letters and digits is
  refused with `NO_TEXT` before any call is made. The parent publication is
  deliberately not counted towards that: the brand is usually named there, and
  judging a comment by its parent is how "Yau he he" became a confident
  `about_subject` in the benchmark. Picture posts are exactly this class.
- A record is restored only on `about_subject` with confidence ≥ 0.9
  (`JEV_RESTORE_CONFIDENCE`), which is where the benchmark measured 99%
  agreement. Below it the answer is stamped `unsure` with the raw verdict and
  confidence kept, so it is not paid for twice and the decision stays auditable.
- The subject's `geographies` and `languages` go into every question, so a
  Bravo in Florida, a Bravo Süpermarket in Adana and an Oba Market in Bonn
  read as different subjects.

`relevanceJudgeProvider()` picks Jev when `TYPESAFE_API_KEY` is set and the
Haiku judge otherwise; `SOCIAL_JUDGE_PROVIDER=anthropic|jev` overrides it, so
switching providers on a bad day is an environment variable rather than a
deploy.

**Scheduling.** `/api/cron/social-relevance-judge` is the pass's caller —
authenticated, bounded to a minute per tick — and the installer carries its
schedule at every fifteen minutes. Every minute would ask a paid provider about
twenty-five records a minute; the queue is finite and each answered record is
stamped, so a slower schedule only delays how soon a wrongly rejected mention
comes back.

Two production actions remain, and both are the owner's:

```bash
# 1. add TYPESAFE_API_KEY as a repository secret, then deliver it to the
#    canonical production app env (the workflow carries the key since
#    2026-09-29; before that it had a fixed list that did not include it)
gh workflow run set-social-app-secrets.yml --repo rashadoni/leaddrive-v2

# 2. install the schedule. The installer ships inside the deployed artifact;
#    /usr/local/lib/leaddrive-v2/ops/current holds only cron-scripts, not this.
ssh prod 'bash /opt/leaddrive-v2/.next/standalone/scripts/install-resilience-crons.sh'
```

Order matters: with the schedule installed and no key, the pass runs on the
Anthropic judge instead — about twenty times the price per record, on a
provider whose answers were never measured on these records.

Until both are done nothing is restored and nothing is spent: without the key
the provider selection falls back to the Haiku judge, and without the schedule
the pass is never called.
