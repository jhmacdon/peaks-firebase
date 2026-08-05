# Luna summit-contact repair prompt

Use `$peaks-route-factory` and follow it exactly.

Your lasting goal is to replace every active Peaks-owned route that misses any
linked summit by more than 5 m. Skip none. Keep the old route active until its
independently sourced replacement passes every publish and public API gate.

This is one bounded worker run:

1. Work only from
   `/Users/josiahm/projects/peaks/.workers/firebase-route-repair` at exact
   `origin/main`.
2. Run every queue call directly through
   `.agents/skills/peaks-route-factory/scripts/route_jobs.sh`. Do not set
   `sandbox_permissions`; the installed rule handles this exact wrapper.
3. Run stats, then claim one job with
   `claim --stage next --integrity-repairs-only --apply`. Do not pass or invent
   a worker ID; the wrapper supplies `luna-route-repair-01`.
4. If the supervisor names one destination for this run, add that exact
   `--destination-id` only to this claim. Do not reuse it on a later run.
5. Require `target_reasons.integrity_repair` to be true. If it is not, release
   the lease and stop with the exact fault.
6. Follow only the returned stage. For rebuild work, research an independent
   OSM, USGS, or other reusable source. Never extend or copy the broken legacy
   path merely to touch the summit. Use only the exact preflighted discovery
   commands in `references/stage-commands.md`; never replace them with a direct
   helper call or raw public-source request. A successful terminal transition
   clears this stage's lease and ends the turn. Never start the next stage with
   the cleared token or a local artifact; a later heartbeat must claim it.
7. The replacement must reach every linked summit within 5 m. An out-and-back
   or point-to-point route must also end within 5 m of its final summit.
8. Keep every rights, access, route identity, segment, provenance, elevation,
   independent-review, activation, and public API gate. Do not lower or waive
   a gate. At the `import` stage, call `import_route_candidate.sh` directly.
   Never put environment assignments, `env`, or a shell before it. Quote the
   full route name as one value and require the dry-run `Name:` and
   `route_name` output to match it before apply.
   At `review`, call `check_pending_route_source.sh` directly, with no command
   prefix or redirection. Build and give the reviewer only the filtered
   `build_route_review_packet.mjs` output, never the full candidate result or
   extra URLs.
9. Finish or release this one lease, run final stats, and leave the checkout
   clean. Never claim a second destination in the same run.

Never seed, migrate, fetch, pull, switch branches, install packages, edit
tracked files, use raw queue SQL, sign in, evade a block, or publish private
GPX geometry. Keep raw HTML, GPX, XML, OSM payloads, path coordinates, and
terrain tiles out of model context and git. After three consecutive shared
tool faults, release the lease and stop for supervisor repair. Do not declare
the lasting goal complete while any integrity-repair job remains.
