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
 * This bundle freezes one source roster. It has no production import or
 * publication path until every identity, cover, and safe route passes review.
 */
export const DOBIH_DEWEYS_PUBLICATION_READY = false as const;

export const DOBIH_DEWEYS_SELECTION = "Dew=1";

export const DOBIH_DEWEYS_COUNTRY_COUNTS = {
  E: 174,
  ES: 6,
  M: 5,
  W: 240,
} as const;

export const DOBIH_DEWEYS_ISLE_OF_MAN_NUMBERS = [
  1946,
  3337,
  3338,
  3339,
  3340,
] as const;

export interface DobihDeweysRoutePublicationBlock {
  sourceMemberId: string;
  name: string;
  reason: "technical_rock_summit";
  routePublicationAllowed: false;
  accessUrl: string;
}

/**
 * Great Links Tor needs a reviewed non-climbing endpoint or a clear exception.
 * A generic route to the summit must never publish from this source bundle.
 */
export const DOBIH_DEWEYS_ROUTE_PUBLICATION_BLOCKS:
  DobihDeweysRoutePublicationBlock[] = [
    {
      sourceMemberId: "dobih:3649",
      name: "Great Links Tor",
      reason: "technical_rock_summit",
      routePublicationAllowed: false,
      accessUrl: "https://ldwa.org.uk/hillwalkers/register5.php",
    },
  ];

export const DOBIH_DEWEYS_KEEPER_LISTS: KeeperListDefinition[] = [
  {
    listId: deterministicKeeperListId("dobih:deweys"),
    sourceKey: "dobih-deweys",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: DOBIH_DEWEYS_SELECTION,
      rosterSha256: "f0aa896b51d6a7f1ae3ec50a774c0c2b17a63288b7f74d5d54de1af143c4fd4a",
    },
    name: "Deweys",
    description:
      "The LDWA Hillwalkers Register records these 425 hills in England, Wales, " +
      "and the Isle of Man. This exact roster comes from DoBIH v18.5.",
    expectedCount: 425,
    destinationOverrides: {},
    allowedCountryCodes: ["GB", "IM"],
    yearEstablished: null,
    organization: "Michael Dewey / LDWA Hillwalkers Register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "England, Wales, and the Isle of Man",
  },
];
