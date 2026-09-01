import {
  deterministicKeeperListId,
  type KeeperListDefinition,
} from "../core";
import { DOBIH_V18_5_SOURCE } from "../sources";

const GENERATED_AT = "2026-08-31";
const SOURCES_SHA256 =
  "54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402";
const SOURCE_NAME = "The Database of British and Irish Hills (CC BY 4.0)";
const SOURCE_URL = "https://www.hill-bagging.co.uk/dobih/downloads/";

/**
 * This bundle freezes source rosters only. It has no production import or
 * publication path until every identity, cover, and safe route passes review.
 */
export const DOBIH_SMALLER_MAJORITY_FOUR_PUBLICATION_READY = false as const;

export const DOBIH_WELSH_3000S_NUMBERS = [
  1963, 1964, 1965, 1966, 1967, 1968, 1969, 1970,
  1971, 1972, 1973, 1974, 1975, 1976, 1977,
] as const;

export const DOBIH_WELSH_3000S_SELECTION =
  `Number IN (${DOBIH_WELSH_3000S_NUMBERS.join(",")})`;

export interface DobihRoutePublicationBlock {
  sourceMemberId: string;
  name: string;
  reason: "live_firing_range";
  routePublicationAllowed: false;
  accessUrl: string;
}

/**
 * These source members need a current, approved access route. A later resolver
 * must carry the blocks to destination IDs before any route can publish.
 */
export const DOBIH_SMALLER_MAJORITY_FOUR_ROUTE_PUBLICATION_BLOCKS:
  DobihRoutePublicationBlock[] = [
    {
      sourceMemberId: "dobih:2711",
      name: "Mickle Fell",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      accessUrl: "https://www.gov.uk/government/publications/warcop-firing-times",
    },
    {
      sourceMemberId: "dobih:2713",
      name: "Little Fell",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      accessUrl: "https://www.gov.uk/government/publications/warcop-firing-times",
    },
    {
      sourceMemberId: "dobih:2735",
      name: "Murton Fell",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      accessUrl: "https://www.gov.uk/government/publications/warcop-firing-times",
    },
    {
      sourceMemberId: "dobih:2877",
      name: "High Willhays",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      accessUrl:
        "https://www.gov.uk/government/publications/dartmoor-guaranteed-public-access",
    },
  ];

export const DOBIH_SMALLER_MAJORITY_FOUR_KEEPER_LISTS: KeeperListDefinition[] = [
  {
    listId: deterministicKeeperListId("dobih:welsh-3000s"),
    sourceKey: "dobih-welsh-3000s",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: DOBIH_WELSH_3000S_SELECTION,
      rosterSha256: "749fc7dda4f61e206dc62539f9e0fd3220411c9417dfeeb93789cc07fff401e2",
    },
    name: "Welsh 3000s",
    description:
      "The Welsh 3000s challenge covers 15 Eryri summits above 3,000 feet. " +
      "This exact 15-hill roster is pinned by DoBIH Number from DoBIH v18.5.",
    expectedCount: 15,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "British Mountaineering Council challenge",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Eryri (Snowdonia), Wales",
  },
  {
    listId: deterministicKeeperListId("dobih:great-britain-submarilyns"),
    sourceKey: "dobih-great-britain-submarilyns",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "sMa=1 AND Country IN (E,ES,S,W)",
      rosterSha256: "80a544c71e8331545620c11510eafb26b18581f8db1a1c2544db5d2bce0c29e0",
    },
    name: "Great Britain Submarilyns",
    description:
      "Alan Dawson's current register includes these 100 Great Britain " +
      "Submarilyns. This roster comes from DoBIH v18.5.",
    expectedCount: 100,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "Alan Dawson / Pedantic Press",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Great Britain",
  },
  {
    listId: deterministicKeeperListId("dobih:donald-deweys"),
    sourceKey: "dobih-donald-deweys",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "DDew=1",
      rosterSha256: "6fb396493ec9e7d48c36f697e7502b51e84d3318c81d87711cdb719ca997c490",
    },
    name: "Donald Deweys",
    description:
      "The LDWA Hillwalkers Register records these 247 hills at least 500 " +
      "metres high and below 2,000 feet in the Scottish Lowlands. This roster " +
      "comes from DoBIH v18.5.",
    expectedCount: 247,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: 2001,
    organization: "David Purchase / LDWA Hillwalkers Register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Scottish Lowlands",
  },
  {
    listId: deterministicKeeperListId("dobih:england-wales-2000-foot-register"),
    sourceKey: "dobih-england-wales-2000-foot-register",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "Hew=1 AND Country IN (E,ES,W)",
      rosterSha256: "8f3b40a77804c91d6f7da955024bce0bfe49bda384a857b82c5797cdaa63bf22",
    },
    name: "Hewitts of England and Wales",
    description:
      "The LDWA Hillwalkers Register accepts the Hewitts as one roster for its " +
      "England and Wales 2000-Foot Hill Register. This 316-hill roster comes " +
      "from DoBIH v18.5.",
    expectedCount: 316,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "Alan Dawson / LDWA Hillwalkers Register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "England and Wales",
  },
];
