#!/usr/bin/env python3
"""Optional offline simple-path solver. Reads one JSON request from stdin.

SciPy is optional. A caller must continue its TypeScript search when this helper
cannot verify a result. No imports or file access beyond the installed solver are
needed at runtime.
"""

import json
import math
import resource
import sys
import time


def peak_rss_mib():
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return value / (1024 * 1024 if sys.platform == "darwin" else 1024)


def finite_number(value, field, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(field + " must be a finite number")
    value = float(value)
    if not math.isfinite(value) or value < 0 or (positive and value == 0):
        raise ValueError(field + " must be " + ("positive" if positive else "nonnegative"))
    return value


def node_id(value):
    if not isinstance(value, str) or not value:
        raise ValueError("node IDs must be nonempty strings")
    return value


def parse_request(request):
    if not isinstance(request, dict):
        raise ValueError("request must be an object")
    start = node_id(request.get("start"))
    maximum = finite_number(request.get("maxDistance", 15000), "maxDistance", True)
    limit = finite_number(request.get("timeLimitSeconds", 60), "timeLimitSeconds", True)
    raw_edges, raw_contacts = request.get("edges"), request.get("contacts")
    if not isinstance(raw_edges, list) or not isinstance(raw_contacts, list):
        raise ValueError("edges and contacts must be arrays")
    edges, edge_ids, nodes = [], set(), {start}
    for edge in raw_edges:
        if not isinstance(edge, dict):
            raise ValueError("each edge must be an object")
        identity = edge.get("id")
        if isinstance(identity, bool) or not isinstance(identity, int) or identity in edge_ids:
            raise ValueError("edge IDs must be unique integers")
        edge_ids.add(identity)
        source, target = node_id(edge.get("from")), node_id(edge.get("to"))
        length = finite_number(edge.get("length"), "edge.length", True)
        if not isinstance(edge.get("named"), bool) or not isinstance(edge.get("road"), bool):
            raise ValueError("edge named and road flags must be booleans")
        nodes.update((source, target))
        # A self-loop cannot belong to a simple source-to-goal path.
        if source != target:
            edges.append({"id": identity, "from": source, "to": target, "length": length,
                          "named": edge["named"] and not edge["road"], "road": edge["road"]})
    contacts = {}
    for contact in raw_contacts:
        if not isinstance(contact, dict):
            raise ValueError("each contact must be an object")
        node = node_id(contact.get("node"))
        connector = finite_number(contact.get("connector"), "contact.connector")
        nodes.add(node)
        # A shorter connector weakly improves every gate and the objective.
        contacts[node] = min(contacts.get(node, math.inf), connector)
    return start, edges, contacts, sorted(nodes), maximum, limit


def verify_path(arcs, selected, start, sink, maximum):
    outgoing = {}
    for index in selected:
        arc = arcs[index]
        if arc["from"] in outgoing:
            raise ValueError("solver incumbent has more than one outgoing arc")
        outgoing[arc["from"]] = arc
    current, seen, ordered = start, set(), []
    while current != sink:
        if current in seen or current not in outgoing:
            raise ValueError("solver incumbent is disconnected or repeats a node")
        seen.add(current)
        arc = outgoing[current]
        ordered.append(arc)
        current = arc["to"]
    if len(ordered) != len(selected) or not ordered[-1]["connector"]:
        raise ValueError("solver incumbent contains disconnected arcs")
    trail = [arc for arc in ordered if not arc["connector"]]
    distance = sum(arc["length"] for arc in trail)
    connector = ordered[-1]["length"]
    total = distance + connector
    bad = sum(arc["length"] for arc in trail if not arc["named"])
    road = sum(arc["length"] for arc in trail if arc["road"])
    named = distance - bad
    # Match the TypeScript gate tolerance in metres. Reject a loose MILP
    # incumbent rather than returning a route which the composer cannot load.
    tolerance = 1e-6
    if (distance <= 0 or total > maximum + tolerance
            or bad + connector > .3 * total + tolerance
            or road > .1 * distance + tolerance or road > .1 * total + tolerance
            or named < .6 * total - tolerance):
        raise ValueError("solver incumbent fails the route quality gates")
    return ([{"edge": arc["id"], "reverse": arc["reverse"]} for arc in trail],
            {"outbound_length_m": distance, "connector_m": connector, "length_m": total,
             "bad_m": bad + connector, "bad_share": (bad + connector) / total,
             "road_m": road, "road_share": road / distance,
             "named_share": named / total, "weighted_cost_m": distance + .6 * bad + 1.5 * road + connector,
             "contact": ordered[-1]["from"], "simple": True})


def solve(request):
    start, edges, contacts, nodes, maximum, time_limit = parse_request(request)
    try:
        import numpy as np
        import scipy
        from scipy.optimize import Bounds, LinearConstraint, milp
        from scipy.sparse import coo_matrix
    except Exception as error:
        return {"status": "unavailable", "message": str(error), "solver_version": None}

    # Use a distinct object so no input string can collide with the virtual sink.
    sink = object()
    nodes.append(sink)
    node_index = {node: i for i, node in enumerate(nodes)}
    arcs = []
    for edge in edges:
        for reverse in (False, True):
            arcs.append({**edge, "from": edge["to"] if reverse else edge["from"],
                         "to": edge["from"] if reverse else edge["to"],
                         "reverse": reverse, "connector": False})
    for node, length in contacts.items():
        # A simple path cannot leave its source and then return to it. A direct
        # source-to-sink connector would have zero outbound trail length.
        if node != start:
            arcs.append({"from": node, "to": sink, "length": length,
                         "named": False, "road": False, "connector": True})
    proof = {"solver_version": "scipy/" + scipy.__version__ + " milp/HiGHS",
             "nodes": len(nodes) - 1, "edges": len(edges), "contacts": len(contacts),
             "time_limit_seconds": time_limit}
    if not edges or not any(arc["connector"] for arc in arcs):
        return {**proof, "status": "infeasible", "message": "No nonzero simple path to a goal contact"}

    arc_count, node_count = len(arcs), len(nodes)
    variable_count = arc_count + node_count
    objective = np.zeros(variable_count)
    incoming, outgoing = [[] for _ in nodes], [[] for _ in nodes]
    for index, arc in enumerate(arcs):
        incoming[node_index[arc["to"]]].append(index)
        outgoing[node_index[arc["from"]]].append(index)
        objective[index] = arc["length"] * (1 if arc["connector"] else
                         1 + .6 * (not arc["named"]) + 1.5 * arc["road"])
    row_ids, column_ids, values, lower, upper = [], [], [], [], []

    def constraint(coefficients, minimum, maximum):
        row = len(lower)
        for column, value in coefficients:
            if value:
                row_ids.append(row)
                column_ids.append(column)
                values.append(value)
        lower.append(minimum)
        upper.append(maximum)

    for index, node in enumerate(nodes):
        balance = 1 if node == start else -1 if node is sink else 0
        constraint([(j, 1) for j in outgoing[index]] + [(j, -1) for j in incoming[index]], balance, balance)
        constraint([(j, 1) for j in incoming[index]], 0, 1)
        constraint([(j, 1) for j in outgoing[index]], 0, 1)
    # Continuous MTZ orders forbid directed cycles. Together with the degree
    # limits and unit flow, they leave exactly one simple source-to-sink path.
    big_m = node_count + 1
    for index, arc in enumerate(arcs):
        constraint([(arc_count + node_index[arc["to"]], 1),
                    (arc_count + node_index[arc["from"]], -1), (index, -big_m)],
                   1 - big_m, np.inf)
    # MTZ already forbids reciprocal arcs at integer solutions. This extra
    # row strengthens the fractional relaxation without removing any path.
    for index in range(len(edges)):
        constraint([(2 * index, 1), (2 * index + 1, 1)], 0, 1)
    constraint([(i, 1) for i, arc in enumerate(arcs) if not arc["connector"]], 1, np.inf)
    # Keep gate rows in metres: kilometre scaling would let the solver's
    # feasibility tolerance hide millimetre violations at ratio boundaries.
    constraint([(i, arc["length"]) for i, arc in enumerate(arcs)], 0, maximum + 1e-6)
    constraint([(i, arc["length"] * ((not arc["named"]) - .3))
                for i, arc in enumerate(arcs)], -np.inf, 1e-6)
    constraint([(i, arc["length"] * (arc["road"] - .1))
                for i, arc in enumerate(arcs) if not arc["connector"]], -np.inf, 1e-6)
    constraint([(i, arc["length"] * (arc["road"] - .1))
                for i, arc in enumerate(arcs)], -np.inf, 1e-6)
    constraint([(i, arc["length"] * (arc["named"] - .6))
                for i, arc in enumerate(arcs)], -1e-6, np.inf)
    variable_lower = np.zeros(variable_count)
    variable_upper = np.r_[np.ones(arc_count), np.full(node_count, node_count)]
    variable_upper[arc_count + node_index[start]] = 0
    matrix = coo_matrix((values, (row_ids, column_ids)), shape=(len(lower), variable_count)).tocsc()
    result = milp(c=objective, integrality=np.r_[np.ones(arc_count), np.zeros(node_count)],
                  bounds=Bounds(variable_lower, variable_upper),
                  constraints=LinearConstraint(matrix, np.array(lower), np.array(upper)),
                  # Any valid approach meets discovery's contract. Stop at a
                  # feasible incumbent; retain the proof gap in the protocol.
                  options={"time_limit": time_limit, "mip_rel_gap": 1, "disp": False})
    proof.update({"message": str(result.message), "constraints": len(lower),
                  "mip_gap": getattr(result, "mip_gap", None),
                  "mip_node_count": getattr(result, "mip_node_count", None),
                  "dual_bound_cost_m": (float(result.mip_dual_bound)
                                        if getattr(result, "mip_dual_bound", None) is not None else None)})
    if result.status == 2:
        return {**proof, "status": "infeasible"}
    if result.status not in (0, 1):
        return {**proof, "status": "error"}
    if result.x is None:
        return {**proof, "status": "limit" if result.status == 1 else "error"}
    try:
        path, statistics = verify_path(arcs, [i for i in range(arc_count) if result.x[i] > .5],
                                       start, sink, maximum)
    except ValueError as error:
        # A numerical incumbent can fail the stricter application gates. No
        # proof or unverified path may then suppress the TypeScript fallback.
        return {**proof, "status": "error", "message": str(error)}
    gap = getattr(result, "mip_gap", None)
    dual = getattr(result, "mip_dual_bound", None)
    proved_cost = ((gap is not None and math.isfinite(gap) and gap == 0)
                   or (dual is not None and math.isfinite(dual)
                       and abs(dual - statistics["weighted_cost_m"]) <= 1e-7))
    status = ("optimal" if proved_cost else "feasible") if result.status == 0 else "limit"
    return {**proof, "status": status, "path": path, **statistics}


def main():
    started = time.monotonic()
    try:
        result = solve(json.load(sys.stdin))
    except Exception as error:
        result = {"status": "error", "message": str(error), "solver_version": None}
    result["elapsed_seconds"] = time.monotonic() - started
    result["max_rss_mib"] = peak_rss_mib()
    # HiGHS uses infinity for some bounds without an incumbent. Keep the wire
    # format valid JSON even when a solver statistic is not finite.
    result = {key: value if not isinstance(value, float) or math.isfinite(value) else None
              for key, value in result.items()}
    print(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
