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

/**
 * This bundle freezes source rosters only. It has no production import or
 * publication path until every identity, cover, and safe route passes review.
 */
export const DOBIH_RHSOC_FOUR_PUBLICATION_READY = false as const;
export const DOBIH_RHSOC_FOUR_ROUTE_SAFETY_AUDIT_COMPLETE = false as const;
export const DOBIH_RHSOC_FOUR_ROUTE_SAFETY_WARNING =
  "This initial block set is non-exhaustive. Absence from it never means a source " +
  "member or proposed route is safe; every route requires separate safety and access review.";
export const DOBIH_RHSOC_FOUR_NAMED_COMPLETION_EXCEPTIONS: readonly string[] = [];

export const DOBIH_GREAT_BRITAIN_MARILYNS_SELECTION =
  "Ma=1 AND Country IN (E,ES,S,W)";
export const DOBIH_HIGH_HILLS_OF_BRITAIN_SELECTION = "HHB=1";
export const DOBIH_SIMMS_SELECTION = "Sim=1";
export const DOBIH_SUBSIMMS_SELECTION = "sSim=1";

export interface DobihRhsocFourRoutePublicationBlock {
  sourceMemberId: string;
  name: string;
  reason:
    | "exposed_grade_2_scramble"
    | "exposed_summit_scramble"
    | "expert_summit_scramble"
    | "live_firing_range"
    | "restricted_sea_stack_access"
    | "rock_climb_and_abseil_required"
    | "rock_climb_required"
    | "technical_climbing_required";
  routePublicationAllowed: false;
  sourceOccurrences: Array<{
    sourceKey: string;
    ordinal: number;
  }>;
  referenceUrl: string;
}

/**
 * These source members remain exact roster members, but no summit route may
 * publish until a separate route-safety review clears it. This initial set is
 * non-exhaustive; absence from it is not evidence that a route is safe.
 */
export const DOBIH_RHSOC_FOUR_ROUTE_PUBLICATION_BLOCKS:
  DobihRhsocFourRoutePublicationBlock[] = [
    {
      sourceMemberId: "dobih:79",
      name: "The Cobbler",
      reason: "exposed_summit_scramble",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 61 },
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 34 },
        { sourceKey: "dobih-simms", ordinal: 57 },
      ],
      referenceUrl: "https://www.walkhighlands.co.uk/lochlomond/the-cobbler.shtml",
    },
    {
      sourceMemberId: "dobih:1212",
      name: "Stac Pollaidh",
      reason: "expert_summit_scramble",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 710 },
        { sourceKey: "dobih-simms", ordinal: 825 },
      ],
      referenceUrl: "https://www.walkhighlands.co.uk/ullapool/stacpollaidh.shtml",
    },
    {
      sourceMemberId: "dobih:1240",
      name: "Sgurr Dearg - Inaccessible Pinnacle",
      reason: "rock_climb_and_abseil_required",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 734 },
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 655 },
        { sourceKey: "dobih-simms", ordinal: 830 },
      ],
      referenceUrl: "https://www.walkhighlands.co.uk/munros/inaccessible-pinnacle",
    },
    {
      sourceMemberId: "dobih:1260",
      name: "Bhasteir Tooth",
      reason: "technical_climbing_required",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 673 },
        { sourceKey: "dobih-subsimms", ordinal: 82 },
      ],
      referenceUrl: "https://www.thebmc.co.uk/en/how-to-scramble-the-cuillin-ridge",
    },
    {
      sourceMemberId: "dobih:1639",
      name: "Stac an Armin",
      reason: "restricted_sea_stack_access",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 1_068 },
      ],
      referenceUrl:
        "https://www.mountaineering.scot/assets/contentfiles/pdf/ScottishMountaineer91.pdf",
    },
    {
      sourceMemberId: "dobih:1641",
      name: "Stac Lee",
      reason: "restricted_sea_stack_access",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 1_070 },
      ],
      referenceUrl:
        "https://www.mountaineering.scot/assets/contentfiles/pdf/ScottishMountaineer91.pdf",
    },
    {
      sourceMemberId: "dobih:2711",
      name: "Mickle Fell",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 1_434 },
        { sourceKey: "dobih-simms", ordinal: 1_340 },
      ],
      referenceUrl: "https://www.gov.uk/government/publications/warcop-firing-times",
    },
    {
      sourceMemberId: "dobih:2713",
      name: "Little Fell",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-simms", ordinal: 1_342 },
      ],
      referenceUrl: "https://www.gov.uk/government/publications/warcop-firing-times",
    },
    {
      sourceMemberId: "dobih:2735",
      name: "Murton Fell",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-simms", ordinal: 1_356 },
      ],
      referenceUrl: "https://www.gov.uk/government/publications/warcop-firing-times",
    },
    {
      sourceMemberId: "dobih:2877",
      name: "High Willhays",
      reason: "live_firing_range",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-great-britain-marilyns", ordinal: 1_510 },
        { sourceKey: "dobih-simms", ordinal: 1_399 },
      ],
      referenceUrl:
        "https://www.gov.uk/government/publications/dartmoor-guaranteed-public-access",
    },
    {
      sourceMemberId: "dobih:2952",
      name: "The Cobbler South Peak",
      reason: "rock_climb_required",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 767 },
        { sourceKey: "dobih-subsimms", ordinal: 168 },
      ],
      referenceUrl: "https://www.walkhighlands.co.uk/lochlomond/the-cobbler.shtml",
    },
    {
      sourceMemberId: "dobih:7888",
      name: "Sgurr nan Gillean Third Pinnacle",
      reason: "rock_climb_and_abseil_required",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 1_010 },
        { sourceKey: "dobih-subsimms", ordinal: 610 },
      ],
      referenceUrl:
        "https://www.ukhillwalking.com/gear/competitions/" +
        "who_won_the_race_along_the_cuillin_ridge-4738",
    },
    {
      sourceMemberId: "dobih:19843",
      name: "Douglas Boulder",
      reason: "rock_climb_required",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-high-hills-of-britain", ordinal: 1_035 },
      ],
      referenceUrl: "https://rockfax.digital/crag/ben-nevis-1434",
    },
    {
      sourceMemberId: "dobih:21237",
      name: "Hag's Tooth",
      reason: "exposed_grade_2_scramble",
      routePublicationAllowed: false,
      sourceOccurrences: [
        { sourceKey: "dobih-subsimms", ordinal: 735 },
      ],
      referenceUrl: "https://kerryclimbing.ie/activities/scrambling/",
    },
  ];

export const DOBIH_RHSOC_FOUR_KEEPER_LISTS: KeeperListDefinition[] = [
  {
    listId: deterministicKeeperListId("dobih:great-britain-marilyns"),
    sourceKey: "dobih-great-britain-marilyns",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: DOBIH_GREAT_BRITAIN_MARILYNS_SELECTION,
      rosterSha256: "055fe69b5a5ad8dc78445fdbc0051e9c062b813f777983d843a844b9943eddbd",
    },
    name: "Great Britain Marilyns",
    description:
      "The Relative Hills Society records the 1,550 Great Britain hills with " +
      "at least 150 metres of drop. This exact roster comes from DoBIH v18.5.",
    expectedCount: 1_550,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: 1992,
    organization: "Alan Dawson / Relative Hills Society",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Great Britain",
  },
  {
    listId: deterministicKeeperListId("dobih:high-hills-of-britain"),
    sourceKey: "dobih-high-hills-of-britain",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: DOBIH_HIGH_HILLS_OF_BRITAIN_SELECTION,
      rosterSha256: "66f5919cddefae958d02337610c0e0218543ebd7cb261a909b98286d004b52e0",
    },
    name: "High Hills of Britain",
    description:
      "The Relative Hills Society records the current 1,035 High Hills of " +
      "Britain. This exact roster comes from DoBIH v18.5.",
    expectedCount: 1_035,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: 2021,
    organization: "Alan Dawson / Relative Hills Society",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Great Britain",
  },
  {
    listId: deterministicKeeperListId("dobih:simms"),
    sourceKey: "dobih-simms",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: DOBIH_SIMMS_SELECTION,
      rosterSha256: "59be2fd9017be3ec6f4284a5e2884f5ad05f77eced5ab53e1b83b1e1139b7a87",
    },
    name: "Simms",
    description:
      "The Relative Hills Society keeps a register for the 2,755 British and " +
      "Irish hills at least 600 metres high with at least 30 metres of drop. " +
      "This exact roster comes from DoBIH v18.5.",
    expectedCount: 2_755,
    destinationOverrides: {},
    allowedCountryCodes: ["GB", "IE", "IM"],
    yearEstablished: null,
    organization: "Alan Dawson / Relative Hills Society",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Britain, Ireland, and the Isle of Man",
  },
  {
    listId: deterministicKeeperListId("dobih:subsimms"),
    sourceKey: "dobih-subsimms",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: DOBIH_SUBSIMMS_SELECTION,
      rosterSha256: "241812f1e490c6521c34dc0bdee310ed3a4eede95a941889d05c793221237c96",
    },
    name: "Subsimms",
    description:
      "The Relative Hills Society keeps a register for the 739 British and " +
      "Irish hills close to Simm status. This exact roster comes from DoBIH " +
      "v18.5.",
    expectedCount: 739,
    destinationOverrides: {},
    allowedCountryCodes: ["GB", "IE"],
    yearEstablished: null,
    organization: "Alan Dawson / Relative Hills Society",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Britain and Ireland",
  },
];
