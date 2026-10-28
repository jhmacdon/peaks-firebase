#!/usr/bin/env python3
"""Propose equivalent-name repairs across whole contiguous trail stretches.

Read-only: proposals still require shared-link snapshots and source review before
they can become repair plans. Audit boundary IDs alone omit inner segments.
"""
import argparse
import collections
import json
import runpy
from pathlib import Path

identity = runpy.run_path(str(Path(__file__).with_name("review-trail-label-audit.py")))["identity"]


def proposals(records):
    segments = {}
    routes = collections.defaultdict(list)
    for row in records:
        if row.get("record") == "segment":
            segments[row["id"]] = row
            routes[row["route_id"]].append(row)
    parent = {}

    def find(segment):
        parent.setdefault(segment, segment)
        while parent[segment] != segment:
            parent[segment] = parent[parent[segment]]
            segment = parent[segment]
        return segment

    for rows in routes.values():
        rows.sort(key=lambda row: row["ordinal"])
        for left, right in zip(rows, rows[1:]):
            if (left["kind"] == right["kind"] == "trail"
                    and left["display_name"] and right["display_name"]
                    and right["ordinal"] == left["ordinal"] + 1
                    and identity(left["display_name"]) == identity(right["display_name"])):
                parent[find(left["id"])] = find(right["id"])
    groups = collections.defaultdict(list)
    for segment in parent:
        groups[find(segment)].append(segment)
    result = []
    for ids in groups.values():
        names = collections.Counter(segments[segment]["display_name"] for segment in ids)
        if len(names) < 2:
            continue

        def score(name):
            return (int("|" not in name and "=" not in name and not name.lower().startswith("inht:")),
                    int(not name.startswith(("-", "/")) and "//" not in name and ";" not in name),
                    int("trail" in name.lower()), int("National" in name), int(" to " in name),
                    int(not any(bad in name for bad in ("HIgh", "FlatIrons", "Mccart"))), names[name], len(name), name)

        canonical = max(names, key=score)
        # These source spellings were checked separately in the October review.
        if identity(canonical) == "salmonsummit":
            canonical = "Salmon Summit Trail"
        if identity(canonical) == "grayspeak":
            canonical = "Grays Peak Trail"
        # Prefer these existing source spellings over split words or lost capitals.
        for preferred in ("Thunderbird Falls Trail", "McKenzie River Trail", "Cable Car Crossing Trail"):
            if preferred in names:
                canonical = preferred
        # These are source codes, not reviewed place names.
        if identity(canonical) == "buf":
            continue
        for segment in sorted(ids):
            before = segments[segment]["display_name"]
            if before != canonical:
                result.append({"id": segment, "before": before, "after": canonical,
                               "component_names": sorted(names), "component_segments": len(ids),
                               "reason": "Same normalized trail identity and terrain across the full contiguous stretch, including inner segments."})
    return sorted(result, key=lambda row: row["id"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    with args.snapshot.open() as source:
        rows = proposals(json.loads(line) for line in source)
    with args.out.open("x") as output:
        json.dump(rows, output, indent=2)
        output.write("\n")
    print(f"Proposed {len(rows)} changes across complete contiguous stretches; no database writes.")


if __name__ == "__main__":
    main()
