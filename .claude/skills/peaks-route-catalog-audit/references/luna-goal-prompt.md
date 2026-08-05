Use `$peaks-route-catalog-audit` and follow it exactly for one bounded audit
run. Work only from the clean checkout named in the automation prompt. Do not
use another worker's checkout.

Treat this heartbeat as a fresh run. Execute `route_audit_jobs.sh stats` now;
never reuse or infer setup, queue, or proxy state from an earlier turn. Do not
report a setup failure unless the exact wrapper failed in this turn. If it
is the approved dedicated automation, run every `route_audit_jobs.sh` call and
every `audit_catalog_routes_worker.sh` and
`fetch_destination_identity_worker.sh` call directly on its first attempt. Do
not set `sandbox_permissions`; installed prefix rules handle the exact approved
wrappers for the local proxy and public identity lookups. Never prepend `bash`,
`zsh`, `env`, `cd`, a variable assignment, or another command.

Then claim exactly one job with `route_audit_jobs.sh claim --lease-minutes 30
--apply`. Do not pass or invent a worker ID; the wrapper derives the worker's
unique ID from its checkout. Audit only the returned destination. Run the
stored-data checker and linked OSM/Wikidata identity check. Research the
accepted normal ascent with two independent public publishers, including a
current official or land-manager source when one exists. Confirm the English
display name, local names, route name, trailhead, distance basis, shape, gain,
class, and access. Never sign in, evade a block, or copy private GPX geometry.
If claim returns `existing_live_lease`, resume that returned destination and
renewed token as this run's one job. Never claim again.

Write the compact source-facts JSON, run the deterministic comparator, and
accept its PASS, FAIL, or REVIEW result. PASS requires every internal gate and
outside fact to agree. Complete the durable job as `passed`, `needs_repair`, or
`needs_human`. Do not repair, activate, supersede, rename, migrate, seed, fetch,
pull, switch branches, edit tracked files, or claim another destination.

Run `audit_catalog_routes_worker.sh` with `yield_time_ms` 30000. If the command
returns a live `session_id`, poll that same process with `write_stdin`, empty
input, and `yield_time_ms` 30000 until it exits. Do not inspect `catalog.json`,
start the identity step, or start a second catalog checker while that session
is live. An empty output file while the process is live is not empty JSON
and is not a retry. If the session cannot finish, send Ctrl-C to that same
session before releasing the lease.

Pass the catalog file with
`--output "$AUDIT_DIR/catalog.json"`. Never use shell redirection for the
catalog checker, including `>` or `>>`. This keeps the approved command prefix
stable across runs.

Heartbeat before browser or map work with `--lease-minutes 30`. Keep raw HTML,
GPX, OSM payloads, path coordinates, and screenshots out of model context and
git. If a command fails, make one safe repair attempt, then release the lease
with an exact error. Stop the lasting goal after the same tool fault or shared
blocker appears on three consecutive destinations.

End with a clean checkout, cleared lease, final stats, destination, stored and
preferred names, standard-route facts, sources, current default, each route
action, final state, exact blocker, and next safe action. Do not declare the
lasting goal complete while any audit job remains queued or auditing.
