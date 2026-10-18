# Pilot schema rollout

Seven migrations passed the isolated API and route-worker CI jobs, including 1,193 worker tests with no failures or skips. The production rollback preview then passed, and the same bundle committed successfully. [Receipts](receipts.json) record the run IDs and hashes; [inspection](inspection.txt) verifies the deployed objects, owners, privileges, triggers, and two inserted trailheads.

The preview and apply bundles differed only in the final `ROLLBACK` or `COMMIT`. [The saved preview](rollback-preview.sql) includes every assertion and the exact migration bodies listed in [the manifest](manifest.json). The schema checks confirmed no changes to route, segment, route-segment, or route-destination rows, and no change to the canonical provenance validator, independent activation function, or credited-cover gate.

Skyline and northern Tipsoo Lake now have separate source-bound trailhead records. No candidate jobs or routes were inserted or activated. The factory login was unavailable in the host keychain, so pending import remains blocked. No reviewer credentials were read.

Fixed cost change: about $0/month. This adds no service, timer, idle CPU, or minimum instance; source receipts and indexes use existing database storage.
