import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  KNPS_ROUTE_ACCESS_AUDIT_PATH,
  getKnpsRouteAccessAudit,
  getKnpsRouteAuditRow,
  parseKnpsRouteAccessAudit,
  validateKnpsCandidateEvidence,
} from "../knps-route-access-audit";

const CHECKED_AT = Date.parse("2026-09-01T01:00:00.000Z");

function rawFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(KNPS_ROUTE_ACCESS_AUDIT_PATH, "utf8")
  ) as Record<string, unknown>;
}

function evidenceFor(destinationId: string) {
  const audit = getKnpsRouteAccessAudit();
  const row = getKnpsRouteAuditRow(destinationId);
  assert.ok(row);
  const access = audit.accessRefs.find((item) => item.id === row.accessRefs[0]);
  assert.ok(access);
  return {
    destinationId,
    identitySources: [
      { type: "knps", url: row.officialCourseSourceUrl },
      { type: "knps", url: access.url },
    ],
    accessSourceUrl: access.url,
    accessStatus: "open",
    nowMs: CHECKED_AT,
  };
}

test("fixture pins all audited dispositions and excludes Saryangdo row 78", () => {
  const audit = getKnpsRouteAccessAudit();
  assert.deepEqual(audit.summary, {
    applicableRowCount: 33,
    provenOpenCount: 16,
    partialGeometryCheckCount: 4,
    archiveGeometryUnresolvedCount: 4,
    conditionalReservationOnlyCount: 2,
    hardBlockCount: 7,
    blockOrSpecialCount: 9,
    excludedRowCount: 1,
  });
  const byClassification = (classification: string) =>
    audit.rows
      .filter((row) => row.classification === classification)
      .map((row) => row.ordinal)
      .sort((a, b) => a - b);
  assert.deepEqual(byClassification("partial_geometry_check"), [17, 42, 67, 86]);
  assert.deepEqual(byClassification("archive_geometry_unresolved"), [3, 12, 19, 59]);
  assert.deepEqual(byClassification("conditional_reservation_only"), [35, 99]);
  assert.deepEqual(byClassification("hard_block"), [7, 16, 27, 46, 72, 73, 93]);
  assert.deepEqual(
    audit.rows
      .filter((row) =>
        ["conditional_reservation_only", "hard_block"].includes(
          row.classification
        )
      )
      .map((row) => row.ordinal)
      .sort((a, b) => a - b),
    [7, 16, 27, 35, 46, 72, 73, 93, 99]
  );
  assert.deepEqual(
    audit.excludedRows.map((row) => [row.ordinal, row.destinationId]),
    [[78, "50DB4EECCEF6077ED000"]]
  );
  assert.equal(getKnpsRouteAuditRow("50DB4EECCEF6077ED000"), undefined);
});

test("fixture keeps exact park, course, access, and time evidence", () => {
  const audit = getKnpsRouteAccessAudit();
  const taebaeksan = getKnpsRouteAuditRow("2575A73825F895B384FC");
  assert.ok(taebaeksan);
  assert.equal(taebaeksan.parkId, "122200");
  assert.deepEqual(taebaeksan.courseIds, ["122200V001"]);
  assert.deepEqual(taebaeksan.nonSummitCourseIds, [
    "122200V002",
    "122200V007",
  ]);
  assert.deepEqual(taebaeksan.accessRefs, ["0029"]);

  const fullClosure = audit.accessRefs.find((access) => access.id === "0005");
  assert.ok(fullClosure);
  assert.equal(fullClosure.state, "FULL");
  assert.equal(fullClosure.effectiveAt, "2026-08-30T15:30:00.000Z");
  assert.deepEqual(
    fullClosure.closedSections.map((section) => section.section),
    ["All park trails"]
  );
  assert.equal(
    fullClosure.url,
    "https://www.knps.or.kr/front/portal/safe/acsCtrDtl.do?menuNo=8000340&rstId=0005"
  );

  const hallasan = audit.accessRefs.find((access) => access.id === "HALLA");
  assert.ok(hallasan);
  assert.equal(hallasan.effectiveAt, null);
  assert.equal(
    hallasan.effectiveLocal,
    "2026-08-01–2026-09-30; exact hour not stated"
  );
  assert.deepEqual(
    hallasan.closedSections.map((section) => section.section),
    ["관음사 삼각봉–백록담"]
  );
});

test("only fresh proven-open destination-bound KNPS evidence passes", () => {
  const evidence = evidenceFor("2575A73825F895B384FC");
  assert.equal(validateKnpsCandidateEvidence(evidence).ordinal, 88);

  assert.throws(
    () =>
      validateKnpsCandidateEvidence({
        ...evidence,
        identitySources: evidence.identitySources.slice(1),
      }),
    /exact audited course page/
  );
  assert.throws(
    () =>
      validateKnpsCandidateEvidence({
        ...evidence,
        accessSourceUrl:
          "https://www.knps.or.kr/front/portal/safe/acsCtrDtl.do?menuNo=8000340&rstId=0017",
      }),
    /exact audited rstId page/
  );
  assert.throws(
    () =>
      validateKnpsCandidateEvidence({
        ...evidence,
        accessStatus: "seasonal",
      }),
    /requires access.status open/
  );
  assert.throws(
    () =>
      validateKnpsCandidateEvidence({
        ...evidence,
        nowMs: Date.parse("2026-09-02T00:30:00.001Z"),
      }),
    /audit is stale/
  );
});

test("partial, unresolved, conditional, hard-block, excluded, and unknown rows fail closed", () => {
  const audit = getKnpsRouteAccessAudit();
  for (const row of audit.rows.filter(
    (item) => item.classification !== "proven_open"
  )) {
    assert.throws(
      () => validateKnpsCandidateEvidence(evidenceFor(row.destinationId)),
      new RegExp(`KFS row ${row.ordinal} is fail-closed: ${row.classification}`)
    );
  }
  assert.throws(
    () =>
      validateKnpsCandidateEvidence({
        ...evidenceFor("2575A73825F895B384FC"),
        destinationId: "50DB4EECCEF6077ED000",
      }),
    /excluded KFS row 78/
  );
  assert.throws(
    () =>
      validateKnpsCandidateEvidence({
        ...evidenceFor("2575A73825F895B384FC"),
        destinationId: "AAAAAAAAAAAAAAAAAAAA",
      }),
    /destination in the reviewed KFS audit/
  );
});

test("fixture parser rejects silent loosening and count drift", () => {
  const extraField = rawFixture();
  (extraField.rows as Array<Record<string, unknown>>)[0].publicationEligible = true;
  assert.throws(
    () => parseKnpsRouteAccessAudit(extraField),
    /must contain exactly/
  );

  const countDrift = rawFixture();
  (countDrift.summary as Record<string, unknown>).provenOpenCount = 17;
  assert.throws(
    () => parseKnpsRouteAccessAudit(countDrift),
    /summary does not match/
  );

  const staleShape = rawFixture();
  const firstAccess = (staleShape.accessRefs as Array<Record<string, unknown>>)[0];
  firstAccess.url =
    "https://www.knps.or.kr/front/portal/safe/acsCtrDtl.do?menuNo=8000340&parkId=120100";
  assert.throws(
    () => parseKnpsRouteAccessAudit(staleShape),
    /exact KNPS rstId detail URL/
  );
});
