import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { type OfficialNetworkPath } from "../official-route-geometry";
import {
  getOfficialTrailSource,
  getPublishableArcgisTrailSource,
  listOfficialTrailSources,
  parseOfficialTrailSourceRegistry,
  publishableArcgisTrailSourcesForCountry,
  reviewOfficialTrailAccess,
} from "../official-trail-sources";

function rawRegistry(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(__dirname, "..", "..", "data", "official-trail-sources.json"),
      "utf8"
    )
  ) as Record<string, unknown>;
}

function rawSources(registry: Record<string, unknown>): Array<Record<string, unknown>> {
  return registry.sources as Array<Record<string, unknown>>;
}

function officialPath(
  featureId: string,
  properties: Record<string, unknown>
): OfficialNetworkPath {
  return {
    featureId,
    properties,
    coordinates: [[-121, 46], [-121.001, 46.001]],
    names: [],
    access: [],
  };
}

test("production registry has exactly one reviewed ArcGIS publisher", () => {
  const sources = listOfficialTrailSources();
  assert.equal(sources.length, 64);
  assert.equal(
    new Set(sources.flatMap((source) => source.coverage.countries)).size,
    51
  );
  assert.deepEqual(
    Object.fromEntries(
      ["ready_publishable", "validation_only", "manual_gap"].map((status) => [
        status,
        sources.filter((source) => source.status === status).length,
      ])
    ),
    { ready_publishable: 1, validation_only: 39, manual_gap: 24 }
  );
  assert.deepEqual(
    sources
      .filter((source) => source.status === "ready_publishable")
      .map((source) => source.id)
      .sort(),
    ["usfs-nfs-trails"]
  );
  assert.ok(sources.every((source) => source.reviewedAt === "2026-08-27"));
  assert.equal(new Set(sources.map((source) => source.id)).size, sources.length);
  assert.ok(sources.every((source) => source.limits.length > 0));
  assert.deepEqual(
    sources
      .filter((source) => source.status === "manual_gap")
      .map((source) => source.id)
      .filter((id) =>
        [
          "antarctica-official-climbing-route-gap",
          "georgia-apa-trails-gap",
          "indonesia-ksdae-mountain-routes-gap",
          "iran-official-mountain-route-gap",
          "kenya-kws-mountain-routes-gap",
          "mexico-conanp-trail-gap",
          "northern-ireland-rights-of-way-gap",
          "philippines-bmb-pais-trails-gap",
          "portugal-icnf-naturalptrails-gap",
          "russia-federal-protected-area-route-gap",
          "tanzania-tanapa-kilimanjaro-routes-gap",
          "uganda-uwa-rwenzori-routes-gap",
        ].includes(id)
      )
      .sort(),
    [
      "antarctica-official-climbing-route-gap",
      "georgia-apa-trails-gap",
      "indonesia-ksdae-mountain-routes-gap",
      "iran-official-mountain-route-gap",
      "kenya-kws-mountain-routes-gap",
      "mexico-conanp-trail-gap",
      "northern-ireland-rights-of-way-gap",
      "philippines-bmb-pais-trails-gap",
      "portugal-icnf-naturalptrails-gap",
      "russia-federal-protected-area-route-gap",
      "tanzania-tanapa-kilimanjaro-routes-gap",
      "uganda-uwa-rwenzori-routes-gap",
    ]
  );
});

test("publishable adapters expose exact official query and rights metadata", () => {
  const usfs = getPublishableArcgisTrailSource("usfs-nfs-trails");
  assert.equal(
    usfs.service.queryUrl,
    "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0/query"
  );
  assert.equal(usfs.service.idField, "globalid");
  assert.equal(usfs.license.attribution, "USDA Forest Service");
  assert.equal(
    usfs.license.url,
    "https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm"
  );
  assert.deepEqual(
    usfs.accessPolicy.rules.map(({ field, operator, values }) => ({
      field,
      operator,
      values,
    })),
    [
      {
        field: "attributesubset",
        operator: "equals_any",
        values: ["TrailNFS_MGMT"],
      },
      {
        field: "allowed_terra_use",
        operator: "equals_any",
        values: [
          "1",
          "21",
          "31",
          "321",
          "41",
          "421",
          "431",
          "4321",
          "531",
          "5321",
          "541",
          "5421",
          "5431",
          "54321",
          "631",
          "6321",
          "64321",
          "6531",
          "65321",
          "6541",
          "65421",
          "65431",
          "654321",
        ],
      },
      {
        field: "hiker_pedestrian_restricted",
        operator: "not_equals_any",
        values: ["01/01-12/31"],
      },
      {
        field: "hiker_pedestrian_disc",
        operator: "not_equals_any",
        values: ["01/01-12/31"],
      },
      {
        field: "hiker_pedestrian_accpt_disc",
        operator: "not_equals_any",
        values: ["01/01-12/31"],
      },
    ]
  );

});

test("source access policies accept only explicit hiking access", () => {
  const usfs = getPublishableArcgisTrailSource("usfs-nfs-trails");
  assert.equal(
    reviewOfficialTrailAccess(usfs, [
      officialPath("forest-trail", {
        ATTRIBUTESUBSET: "TrailNFS_MGMT",
        allowed_terra_use: "654321",
        hiker_pedestrian_restricted: null,
      }),
    ]).passed,
    true
  );
});

test("source access policies reject closed, non-hiking, and unresolved features", () => {
  const usfs = getPublishableArcgisTrailSource("usfs-nfs-trails");
  const usfsReview = reviewOfficialTrailAccess(usfs, [
    officialPath("basic-only", {
      attributesubset: "TrailNFS_Basic",
      allowed_terra_use: null,
      hiker_pedestrian_restricted: null,
    }),
    officialPath("restricted", {
      attributesubset: "TrailNFS_MGMT",
      allowed_terra_use: "1",
      hiker_pedestrian_restricted: "01/01-12/31 ",
      hiker_pedestrian_disc: "01/01-12/31",
      hiker_pedestrian_accpt_disc: "01/01-12/31",
    }),
    officialPath("unknown-code", {
      attributesubset: "TrailNFS_MGMT",
      allowed_terra_use: "10",
      hiker_pedestrian_restricted: null,
      hiker_pedestrian_disc: null,
      hiker_pedestrian_accpt_disc: null,
    }),
  ]);
  assert.equal(usfsReview.passed, false);
  assert.match(usfsReview.errors.join("\n"), /basic-only fails attributesubset/);
  assert.match(usfsReview.errors.join("\n"), /basic-only fails allowed_terra_use/);
  assert.match(
    usfsReview.errors.join("\n"),
    /restricted fails hiker_pedestrian_restricted/
  );
  assert.match(
    usfsReview.errors.join("\n"),
    /restricted fails hiker_pedestrian_disc/
  );
  assert.match(
    usfsReview.errors.join("\n"),
    /restricted fails hiker_pedestrian_accpt_disc/
  );
  assert.match(
    usfsReview.errors.join("\n"),
    /unknown-code fails allowed_terra_use/
  );
});

test("NPS stays validation-only until live public access is usable", () => {
  const nps = getOfficialTrailSource("nps-public-trails");
  assert.equal(nps.status, "validation_only");
  assert.equal(nps.service, undefined);
  assert.equal(nps.accessPolicy, undefined);
  assert.match(nps.limits.join("\n"), /OPENTOPUBLIC is unpopulated/);
  assert.match(nps.limits.join("\n"), /former positive access rule matched no records/);
  assert.throws(
    () => getPublishableArcgisTrailSource("nps-public-trails"),
    /not approved for publication/
  );
});

test("lookup and country helpers fail closed", () => {
  assert.deepEqual(
    publishableArcgisTrailSourcesForCountry("us").map((source) => source.id).sort(),
    ["usfs-nfs-trails"]
  );
  assert.deepEqual(publishableArcgisTrailSourcesForCountry("ca"), []);
  assert.throws(() => publishableArcgisTrailSourcesForCountry("USA"), /ISO 3166/);
  assert.throws(() => getOfficialTrailSource("not-a-source"), /Unknown official/);
  assert.throws(
    () => getPublishableArcgisTrailSource("parks-canada-trails"),
    /not approved for publication/
  );
});

test("USGS remains recorded as an existing adapter", () => {
  const source = getOfficialTrailSource("usgs-national-digital-trails");
  assert.equal(source.status, "validation_only");
  assert.equal(source.sourceKind, "existing_adapter");
  assert.equal(source.existingAdapter, "usgs-national-digital-trails");
  assert.equal(source.service, undefined);
});

test("KFS archive stays validation-only and separate from current access", () => {
  const source = getOfficialTrailSource("south-korea-kfs-hiking-trails-archive");
  assert.equal(source.status, "validation_only");
  assert.equal(source.sourceKind, "managed_trails");
  assert.equal(source.service, undefined);
  assert.equal(source.accessPolicy, undefined);
  assert.equal(source.license.commercialUse, "unclear");
  assert.equal(source.license.derivativeUse, "unclear");
  assert.equal(
    source.endpoints.find((endpoint) => endpoint.type === "bulk")?.url,
    "https://www.forest.go.kr/kfsweb/opda/dataMng/fileDown.do?dataType=/mount/mountain.zip"
  );
  assert.match(source.limits.join("\n"), /2016-12-31/);
  assert.match(source.limits.join("\n"), /not current access/i);
  assert.match(source.limits.join("\n"), /trailhead candidates/i);
  assert.throws(
    () => getPublishableArcgisTrailSource(source.id),
    /not approved for publication/
  );
});

test("reviewed catalog keeps current sources and uncertain rights fail closed", () => {
  const parksCanada = getOfficialTrailSource("parks-canada-trails");
  assert.match(
    parksCanada.endpoints[0].url,
    /Trails_Sentiers_APCA_Temporary_Temporaire_APCA_OpenOuvert/
  );
  assert.match(parksCanada.limits.join("\n"), /transitional/);

  const doc = getOfficialTrailSource("new-zealand-doc-tracks");
  assert.match(doc.name, /Deprecated/);
  assert.match(doc.limits.join("\n"), /no longer maintained/);

  const tokai = getOfficialTrailSource("japan-moe-tokai-nature-trail");
  assert.equal(tokai.status, "validation_only");
  assert.equal(
    tokai.endpoints[0].url,
    "https://www.env.go.jp/content/000304454.zip"
  );
  assert.equal(
    getOfficialTrailSource("japan-other-long-distance-trails-gap").status,
    "manual_gap"
  );

  assert.equal(
    getOfficialTrailSource("hong-kong-afcd-country-park-trails").license
      .derivativeUse,
    "unclear"
  );
  assert.equal(
    getOfficialTrailSource("new-south-wales-npws-track-sections").license
      .commercialUse,
    "unclear"
  );
  assert.equal(
    getOfficialTrailSource("mainland-china-official-route-gap").status,
    "manual_gap"
  );

  const austria = getOfficialTrailSource("austria-gip-alpine-paths");
  assert.equal(austria.status, "validation_only");
  assert.equal(austria.license.derivativeUse, "allowed");
  assert.equal(austria.license.attribution, "Datenquelle: gip.gv.at");
  assert.equal(
    getOfficialTrailSource("slovenia-mapzs-mountain-trails").license
      .derivativeUse,
    "unclear"
  );
  assert.equal(
    getOfficialTrailSource("croatia-geohrvatska-hiking-trails").status,
    "validation_only"
  );
  assert.match(
    getOfficialTrailSource("italy-cai-sentiero-italia").limits.join("\n"),
    /Do not copy the CAI GPX/
  );

  for (const id of [
    "colombia-pnnc-ecotourism-trails",
    "costa-rica-sinac-chirripo-trails",
    "czechia-zabaged-marked-hiking-routes",
    "poland-bdot10k-foot-cycle-paths",
  ]) {
    assert.equal(getOfficialTrailSource(id).status, "validation_only");
  }
  for (const id of [
    "greece-necca-national-trail-network-gap",
    "kazakhstan-state-tourist-route-register-gap",
    "south-africa-sanparks-trails-gap",
    "turkiye-dkmp-ekotaban-routes-gap",
  ]) {
    assert.equal(getOfficialTrailSource(id).status, "manual_gap");
  }
});

test("parser rejects unknown fields and duplicate IDs", () => {
  const unknownField = rawRegistry();
  rawSources(unknownField)[0].typo = true;
  assert.throws(
    () => parseOfficialTrailSourceRegistry(unknownField),
    /typo is not allowed/
  );

  const duplicate = rawRegistry();
  rawSources(duplicate)[1].id = rawSources(duplicate)[0].id;
  assert.throws(
    () => parseOfficialTrailSourceRegistry(duplicate),
    /source IDs must be unique|publishable sources/
  );
});

test("parser rejects unsafe endpoints and rights escalation", () => {
  const insecure = rawRegistry();
  const service = rawSources(insecure)[0].service as Record<string, unknown>;
  service.queryUrl = "http://example.test/FeatureServer/0/query";
  assert.throws(
    () => parseOfficialTrailSourceRegistry(insecure),
    /must use HTTPS/
  );

  const rightsEscalation = rawRegistry();
  const parksCanada = rawSources(rightsEscalation).find(
    (source) => source.id === "parks-canada-trails"
  );
  assert.ok(parksCanada);
  parksCanada.status = "ready_publishable";
  assert.throws(
    () => parseOfficialTrailSourceRegistry(rightsEscalation),
    /not in the publishable source allowlist/
  );

  const serviceOnValidationOnly = rawRegistry();
  const validationSource = rawSources(serviceOnValidationOnly).find(
    (source) => source.id === "parks-canada-trails"
  );
  assert.ok(validationSource);
  validationSource.service = {
    type: "arcgis",
    queryUrl: "https://example.test/FeatureServer/0/query",
    idField: "ID",
    nameFields: ["NAME"],
    accessFields: ["STATUS"],
  };
  assert.throws(
    () => parseOfficialTrailSourceRegistry(serviceOnValidationOnly),
    /reserved for publishable sources/
  );
});

test("parser rejects missing limits and publishable license restrictions", () => {
  const noLimits = rawRegistry();
  rawSources(noLimits)[0].limits = [];
  assert.throws(
    () => parseOfficialTrailSourceRegistry(noLimits),
    /limits must be a non-empty array/
  );

  const restricted = rawRegistry();
  const license = rawSources(restricted)[0].license as Record<string, unknown>;
  license.commercialUse = "restricted";
  assert.throws(
    () => parseOfficialTrailSourceRegistry(restricted),
    /does not allow publication/
  );
});

test("parser requires a valid access policy for every publishable adapter", () => {
  const missing = rawRegistry();
  delete rawSources(missing)[0].accessPolicy;
  assert.throws(
    () => parseOfficialTrailSourceRegistry(missing),
    /accessPolicy is required for a publishable source/
  );

  const unknownField = rawRegistry();
  const policy = rawSources(unknownField)[0].accessPolicy as {
    rules: Array<Record<string, unknown>>;
  };
  policy.rules[0].field = "unfetched_status";
  assert.throws(
    () => parseOfficialTrailSourceRegistry(unknownField),
    /must also appear in service.accessFields/
  );

  const unknownOperator = rawRegistry();
  const secondPolicy = rawSources(unknownOperator)[0].accessPolicy as {
    rules: Array<Record<string, unknown>>;
  };
  secondPolicy.rules[0].operator = "trust_source_name";
  assert.throws(
    () => parseOfficialTrailSourceRegistry(unknownOperator),
    /operator has an unsupported value/
  );

  const negativeOnly = rawRegistry();
  const negativePolicy = rawSources(negativeOnly)[0].accessPolicy as {
    rules: Array<Record<string, unknown>>;
  };
  negativePolicy.rules = [
    {
      field: "hiker_pedestrian_restricted",
      operator: "not_contains_any",
      values: ["01/01-12/31"],
      reason: "all-year restrictions must be absent",
    },
  ];
  assert.throws(
    () => parseOfficialTrailSourceRegistry(negativeOnly),
    /must include a positive access rule/
  );
});
