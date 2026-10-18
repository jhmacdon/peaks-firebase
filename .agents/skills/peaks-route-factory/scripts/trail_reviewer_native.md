# Native filtered trail reviewer

This adapter runs the exact trusted `peaks_trail_reviewer` developer contract in
a fresh native `codex exec` session, with `gpt-6.1-sol`, high reasoning and read-only
execution. It uses no database, lane password, credential loader or researcher
verdict. It does not claim to select a project agent by name: it loads the pinned
TOML contract as trusted developer instructions. The only prompt is the absolute
bound packet path. Never resume a session or attach factory history.

Use only after the separate reviewer login is approved and verified, and the
supervised review CLI has bound a fresh SQL-owned reviewer packet. Supply the
packet's exact byte SHA-256 and the current SQL lease expiry; do not guess an
expiry from the packet. The adapter checks UUID/lane/place/route/template bindings,
24-hour evidence freshness, exact XYZ/map hashes, private file mode and the
15-minute lease bound. SQL remains the authority for current lease ownership and
immutable packet binding; the later review dry/apply commands recheck both.

## Offline preflight and first review

From a clean approved task checkout, with fresh paths outside the checkout:

```sh
/opt/homebrew/bin/python3 -I -B \
  .agents/skills/peaks-route-factory/scripts/trail_reviewer_native.py preflight \
  --packet /private/tmp/trail-review/bound.json \
  --packet-sha256 EXACT_BOUND_PACKET_SHA256 \
  --lease-expires-at CURRENT_SQL_LEASE_EXPIRY_UTC \
  --report /private/tmp/trail-review/native-preflight.json
```

Preflight uses a dummy provider key and a localhost fixture. The fixture returns
one fixed packet-reader tool call, captures the next request, then stops with an
HTTP error. It performs no inference and never forwards a real model auth header.
It proves the pinned contract, inspected ambient context, tool declarations and
original PNG image delivery through the installed native CLI. It records hashes
and names only, not packet text, lease tokens, auth headers or global instructions.
Localhost binding may require the host's tool permission. Failed preflight blocks
a live run; do not suppress it or widen its allowlist.

For the first supervised review, after reviewer account approval and verification:

```sh
/opt/homebrew/bin/python3 -I -B \
  .agents/skills/peaks-route-factory/scripts/trail_reviewer_native.py run \
  --packet /private/tmp/trail-review/bound.json \
  --packet-sha256 EXACT_BOUND_PACKET_SHA256 \
  --lease-expires-at CURRENT_SQL_LEASE_EXPIRY_UTC \
  --report /private/tmp/trail-review/native-run.json \
  --output /private/tmp/trail-review/result.json --allow-model-run
```

`run` repeats the offline preflight before native inference. It passes no lane,
cloud, proxy, API-key override or Node/Python hook environment. Native Codex alone
uses its normal model authentication. The adapter neither reads nor copies that
auth file. It writes a result only after exactly one completed bound-packet read,
a valid final JSON object, unchanged packet bytes, and an unexpired deadline.
It preserves the reviewer's final JSON text. Outputs use exclusive creation and
mode 0600; any failure or nonzero exit means no accepted result. Require a passing
run report before using a result. The adapter never approves or publishes a route.

Save the result through the existing supervised `trail_catalog_review.sh review`
dry/apply sequence. Heartbeat belongs to the operator's reviewer lane. An expired
packet needs a new SQL lease and independent review; this runner cannot requeue,
repair, heartbeat, or impersonate a reviewer login.

## Context and tool limits

The native CLI adds core policy, the inspected global user guidance, skill catalog
metadata and generated environment metadata. Those are not route evidence or this
chat's history. The trusted developer contract forbids skill reads and keeps
packet instructions untrusted. Pins reject changes to the CLI, profile, core
policy or inspected ambient text before inference. Do not treat catalog metadata
as permission to load a skill or another file.

Shell, browser, web search, apps, plugins, hooks, delegation, goals and local image
file tools are disabled. Native metadata still lists its resource helpers and
`request_user_input`; they are unused. Any actual action beyond the one bound
reader aborts the owned process group and rejects the result. Unknown tools,
extra initial route context, failed reader calls and extra final messages fail.

The local stdio MCP exposes one reader. It accepts only the exact packet path and
hash supplied outside packet data, rechecks freshness on each call, and refuses
resources or other files. It accepts native transport `_meta` without using it as
evidence. It returns packet fields plus the original PNG as an actual image block;
opaque image base64 is represented by a display marker in the text to avoid
sending it as tokens twice. This changes no packet file, hash, attestation, source
proof or image bytes. Missing, wrong or visually unclear maps still fail the human
map gate; successful transport is not a map verdict.

## Checks and pins

```sh
/opt/homebrew/bin/python3 -I -B \
  .agents/skills/peaks-route-factory/scripts/trail_reviewer_native_test.py

# Host-only localhost/dummy-provider checks; no inference or real model auth.
TRAIL_REVIEWER_NATIVE_TRANSPORT_TEST=1 /opt/homebrew/bin/python3 -I -B \
  .agents/skills/peaks-route-factory/scripts/trail_reviewer_native_test.py NativeTransportTests
```

The runner pins macOS arm64 `codex-cli 0.156.1`, executable SHA-256
`0196e89fe5a7598f816ee54232c3d7c26d75e502ab5cfe2c9240e81d90f7255a`, and the
existing profile SHA-256
`480c89cc46f62625c845b22085e01bbadf2d18ce4ece56af5aa8b72314b5b6fa`.
A changed pin requires a new offline check and code review. This task does not
support another CLI build or model. The native protocol schemas came from that
installed binary's `app-server generate-json-schema --experimental` command;
no paid run generated them.

Official OpenAI documentation explains [trusted custom-agent config layers](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and [native exec/config/image behavior](https://learn.chatgpt.com/docs/developer-commands).
The actual installed CLI capture governs these version-specific guards.
Fixed infrastructure cost remains $0/month. A live review
uses normal Codex account inference; offline checks use none.
