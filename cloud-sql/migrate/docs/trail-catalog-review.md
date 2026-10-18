# Review and activate named catalog trails

Apply `20261014_trail_catalog_review_activation.sql` before using this command.
Use a clean, approved task checkout. The supervised wrapper loads no credentials
and has no operator or other-lane fallback. An operator supplies only the already
loaded lane `DB_PASS` from the chosen task's approved environment. The wrapper pins
`127.0.0.1:5432/peaks` and `peaks-route-reviewer-worker` for reviewer commands or
`peaks-route-factory-worker` for factory commands; target/user overrides fail
before a connection. The CLI checks the authenticated database role before any
claim or audit. Packet, review, heartbeat and release require exactly the reviewer
marker role; activation and verification require exactly the factory marker role.
Never copy or request credentials from the other lane.

All commands default to dry runs. Each run records `data_source_runs` and reserves
a fresh JSONL report. Apply requires the exact dry `reviewHash`. Files must live
outside the checkout so that writing a report does not make the checkout dirty.
The packet and result contain no credentials. Treat them as audit evidence and
do not overwrite them.

```bash
mkdir -p /private/tmp/trail-review

# Reviewer login: create a filtered draft and inspect its report/hash.
.agents/skills/peaks-route-factory/scripts/trail_catalog_review.sh packet \
  --source-key reviewed-source-key \
  --output /private/tmp/trail-review/draft.json \
  --report /private/tmp/trail-review/packet-dry.jsonl

# Bind a fresh reviewer lease and an immutable packet in SQL.
.agents/skills/peaks-route-factory/scripts/trail_catalog_review.sh packet \
  --source-key reviewed-source-key \
  --plan /private/tmp/trail-review/draft.json \
  --output /private/tmp/trail-review/bound.json \
  --report /private/tmp/trail-review/packet-bind.jsonl \
  --apply --review-hash REVIEWED_DRY_SHA256
```

Use the new `peaks_trail_reviewer` project agent with fresh context and only the
absolute path `/private/tmp/trail-review/bound.json`. Follow
[the trusted review contract](../../../.agents/skills/peaks-route-factory/references/trail-review-contract.md).
Do not attach a factory result, another evidence file, a suggested verdict, or
chat history. The reviewer returns JSON only; save it unchanged as
`/private/tmp/trail-review/result.json`.

If the current tool surface cannot select the project agent, use the
[pinned native equivalent](../../../.agents/skills/peaks-route-factory/scripts/trail_reviewer_native.md).
It loads that same trusted contract, with fresh context and only the bound packet
path as its prompt. It preserves the review gates and requires the approved,
verified reviewer account.

The packet contains exact live XYZ geometry, current independent source proofs,
the twelve machine gates, a hash-bound map PNG, and compact public evidence. It
omits factory verdicts and raw source bundles. Evidence must be at most 24 hours
old. The packet apply reruns source and machine checks and renders the map again;
a changed map or source proof requires a new draft. The reviewer must actually
inspect the inline image. Missing maps, inaccessible evidence and unsupported
binary/PDF text stay visible and fail the affected human gate. Pending photos do
not satisfy the credited-cover gate.

```bash
# Reviewer login: validate the exact bound packet and independent result.
.agents/skills/peaks-route-factory/scripts/trail_catalog_review.sh review \
  --source-key reviewed-source-key \
  --packet /private/tmp/trail-review/bound.json \
  --result /private/tmp/trail-review/result.json \
  --report /private/tmp/trail-review/review-dry.jsonl

.agents/skills/peaks-route-factory/scripts/trail_catalog_review.sh review \
  --source-key reviewed-source-key \
  --packet /private/tmp/trail-review/bound.json \
  --result /private/tmp/trail-review/result.json \
  --report /private/tmp/trail-review/review-apply.jsonl \
  --apply --review-hash REVIEWED_DRY_SHA256
```

Leases last 15 minutes. To keep an owned reviewer lease during review, run
`heartbeat --source-key reviewed-source-key --packet ... --report ...` first dry,
then with `--apply --review-hash` from that dry report. `release` uses the same
flags. Neither action can change reviewer identity, the packet or a result.
An expired lease must be reclaimed under the correct lane, with the exact same
input. Its old packet is invalid; build and independently review a newly bound
packet.

```bash
# Factory login in its own approved environment: plan one publication.
.agents/skills/peaks-route-factory/scripts/trail_catalog_review.sh activate \
  --source-key reviewed-source-key --receipt-hash APPROVED_SQL_RECEIPT_SHA256 \
  --report /private/tmp/trail-review/activate-dry.jsonl

.agents/skills/peaks-route-factory/scripts/trail_catalog_review.sh activate \
  --source-key reviewed-source-key --receipt-hash APPROVED_SQL_RECEIPT_SHA256 \
  --report /private/tmp/trail-review/activate-apply.jsonl \
  --apply --review-hash REVIEWED_DRY_SHA256
```

Activation calls only the owned SQL function. Each route needs a PASS receipt,
fresh exact source and place bindings, current publish integrity, a credited
approved cover, the existing five-point source-check floor, all linked summit
contacts within 5 m, and every other gate. Default input size is one; an explicit
`--batch-size` accepts at most 500 paired source keys and receipt hashes. The
runner still activates and verifies one route at a time.

After each activation it checks the existing rematch queue, the canonical public
route API and the ranked `/api/search/all` results for the route's common name.
The report includes search rank and the share of length on shared segments.
The SQL barrier blocks the next route until verification passes. It survives a
crash or failed public check. There is no alternate public URL flag or environment
fallback. Let the existing authenticated `/internal/sweep` drain rematches; this
CLI does not start a timer, service or unauthenticated sweep.

If activation succeeds while rematches or public verification remain incomplete,
inspect the report, allow the existing sweep to drain, then run `verify` with the
same source key and receipt hash first dry and then with that dry `reviewHash`.
Do not activate the route again or start the next batch.

Lost mutation acknowledgements are `outcomeUnconfirmed`; the audit records an
unknown write total and preserves confirmed writes and route IDs. Inspect the
durable receipt before retrying. Rejected receipts remain immutable. A changed
source, route, segment, place or terminal rejection needs explicit operator
inspection and repair; ordinary retry does not fix it. This phase provides no
repair, requeue, rename, delete or gate override command.

Fixed infrastructure cost: $0/month. The pilot reuses Cloud SQL and the existing
rematch sweep. Review receipts and small map previews add stored data only.
