#!/usr/bin/env python3
"""Join the original flags, committed repairs, and a fresh read-only audit.

This records a decision for each flag. It never treats shared aliases as proof
that differently named trails are the same trail, and never writes to the DB.
"""
import argparse
import collections
import json
import re
import unicodedata
from pathlib import Path


def identity(name):
    name = unicodedata.normalize("NFKC", name).casefold().strip()
    name = re.sub(r"^(inht:\s*|national_name=)", "", name)
    name = name.replace("national scenic trail", "trail").replace("national recreation trail", "trail")
    return re.sub(r"[^a-z0-9]", "", re.sub(r"\s+trail$", "", name))


def review(before, after, directory):
    changed = {}
    touched_routes = set()
    renamed_routes = {}
    for path in sorted(directory.glob("*.receipt.json")):
        receipt = json.loads(path.read_text())
        if receipt["status"] != "committed":
            raise ValueError(f"Uncommitted receipt: {path}")
        for row in receipt.get("rows", []):
            changed[row["id"]] = path.name
            touched_routes.update(link["route_id"] for link in row["links"])
        if "segment" in receipt:
            changed[receipt["segment"]] = path.name
            touched_routes.update(row["id"] for row in receipt["routes"])
        for row in receipt.get("route_names", []):
            renamed_routes[row["id"]] = row["name"]
            touched_routes.add(row["id"])
    winter = set(json.loads((directory / "accepted-winter-routes.json").read_text())["segment_ids"])
    ice = {row["id"]: row for row in json.loads((directory / "ice-needs-review.json").read_text())}
    original = {row["id"]: row for row in before if row.get("record") == "route"}
    current = {row["id"]: row for row in after["findings"]}
    outcomes = []
    counts = collections.Counter()
    for route_id in sorted(original.keys() | current.keys()):
        old = original.get(route_id)
        now = current.get(route_id)
        route = now or old
        decisions = []
        for issue in (now or {}).get("issues", []):
            code = issue["code"]
            if code in ("missing_segments", "missing_segment"):
                decision = "needs_geometry_repair"
                reason = "No stored stretches to name. Recover verified geometry and links; do not invent terrain."
            elif code == "ice_named_as_trail" and set(issue["segment_ids"]) <= winter:
                decision = "accepted_named_winter_route"
                reason = "NPS names these designated Dewey Point winter routes; they are not ice-body names."
            elif code == "unnamed_ice" and set(issue["segment_ids"]) <= ice.keys():
                decision = "needs_terrain_review"
                reason = "Stored ice extends beyond the available source polygons; a name alone would hide the uncertainty."
            elif code == "name_repeated_across_kinds":
                decision = "retained_terrain_transition"
                reason = "A named route can cross more than one terrain type. Keep the change in terrain visible."
            elif code == "adjacent_trail_aliases":
                if len({identity(name) for name in issue["names"] if name}) == 1:
                    decision = "needs_name_review"
                    reason = "Equivalent-name candidates remain after the repair; inspect their current shared links and labels."
                else:
                    decision = "retained_distinct_labels"
                    reason = "Different labels share an alias. That alone does not establish duplicate names or justify merging them."
            else:
                decision = "needs_name_review"
                reason = "No reviewed correction or documented exception covers this remaining flag."
            counts[decision] += 1
            decisions.append({"decision": decision, "reason": reason, **issue})
        affected = set()
        for source in (old, now):
            if source:
                affected.update(segment for issue in source["issues"] for segment in issue["segment_ids"] if segment in changed)
        outcomes.append({"record": "route", "id": route_id, "name": renamed_routes.get(route_id, route["name"]),
                         "status": route["status"], "original_flag_count": len((old or {}).get("issues", [])),
                         "repaired_flagged_segments": sorted(affected),
                         "receipts": sorted({changed[segment] for segment in affected}),
                         "remaining_decisions": decisions})
    needs = [row for row in outcomes if any(d["decision"].startswith("needs_") for d in row["remaining_decisions"])]
    return {"record": "summary", "generated_at": after["generated_at"],
            "after_snapshot_sha256": after["snapshot_sha256"], "catalog": after["summary"],
            "original_flagged_routes": len(original), "changed_segments": len(changed),
            "renamed_routes": len(renamed_routes),
            "linked_routes_including_superseded": len(touched_routes),
            "remaining_decisions": dict(counts), "routes_needing_more_work": len(needs)}, outcomes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before-jsonl", type=Path, required=True)
    parser.add_argument("--after-json", type=Path, required=True)
    parser.add_argument("--repairs-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    before = [json.loads(line) for line in args.before_jsonl.read_text().splitlines()]
    summary, outcomes = review(before, json.loads(args.after_json.read_text()), args.repairs_dir)
    with args.out.open("x") as output:
        for row in [summary, *outcomes]:
            output.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
