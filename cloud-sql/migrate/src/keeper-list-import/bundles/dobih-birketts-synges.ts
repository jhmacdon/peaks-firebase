import {
  deterministicKeeperListId,
  type KeeperListDefinition,
} from "../core";
import { DOBIH_V18_5_SOURCE } from "../sources";

const GENERATED_AT = "2026-09-01";
const SOURCES_SHA256 =
  "54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402";
const SOURCE_NAME = "The Database of British and Irish Hills (CC BY 4.0)";
const SOURCE_URL = "https://www.hill-bagging.co.uk/dobih/downloads/";
const LDWA_REGISTER_URL = "https://ldwa.org.uk/hillwalkers/register2.php";

/**
 * This bundle freezes two source rosters. It has no production import or
 * publication path until every identity, cover, and safe route passes review.
 */
export const DOBIH_BIRKETTS_SYNGES_PUBLICATION_READY = false as const;

export const DOBIH_BIRKETTS_SELECTION = "B=1";
export const DOBIH_SYNGES_SELECTION = "Sy=1";

export interface DobihBirkettsSyngesRoutePublicationBlock {
  sourceMemberId: string;
  name: string;
  reason: "technical_rock_summit";
  routePublicationAllowed: false;
  claimAcceptedWithoutSummit: true;
  sourceKeys: ["dobih-birketts", "dobih-synges"];
  accessUrl: string;
}

/**
 * Pillar Rock is an exposed rock climb, not a walking or scrambling summit.
 * The LDWA accepts both list claims without it. A later production model must
 * preserve this named exception instead of allowing any one member to be
 * skipped through a numeric completion target.
 */
export const DOBIH_BIRKETTS_SYNGES_ROUTE_PUBLICATION_BLOCKS:
  DobihBirkettsSyngesRoutePublicationBlock[] = [
    {
      sourceMemberId: "dobih:2390",
      name: "Pillar Rock",
      reason: "technical_rock_summit",
      routePublicationAllowed: false,
      claimAcceptedWithoutSummit: true,
      sourceKeys: ["dobih-birketts", "dobih-synges"],
      accessUrl: LDWA_REGISTER_URL,
    },
  ];

export const DOBIH_BIRKETTS_SYNGES_KEEPER_LISTS: KeeperListDefinition[] = [
  {
    listId: deterministicKeeperListId("dobih:birketts"),
    sourceKey: "dobih-birketts",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: DOBIH_BIRKETTS_SELECTION,
      rosterSha256: "970e671250616e38c0f9767acf26f058c7d2ebecd69568457512cfc25f9918d7",
    },
    name: "Birketts",
    description:
      "The LDWA Hillwalkers Register records the 541 Lake District fells in " +
      "Bill Birkett's Complete Lakeland Fells. This exact roster comes from " +
      "DoBIH v18.5.",
    expectedCount: 541,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: 1994,
    organization: "Bill Birkett / LDWA Hillwalkers Register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Lake District, England",
  },
  {
    listId: deterministicKeeperListId("dobih:synges"),
    sourceKey: "dobih-synges",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: DOBIH_SYNGES_SELECTION,
      rosterSha256: "8d9bb012fea4f2c5135ff972c83d354b43f8706add77f125649527beb67acaff",
    },
    name: "Synges",
    description:
      "The LDWA Hillwalkers Register records the current 670 Lake District " +
      "summits in Tim Synge's 2025 roster. This exact roster comes from " +
      "DoBIH v18.5.",
    expectedCount: 670,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: 1995,
    organization: "Tim Synge / LDWA Hillwalkers Register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Lake District, England",
  },
];
