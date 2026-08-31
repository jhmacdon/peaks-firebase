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
 * Four open-source hill registers that would move the reviewed denominator
 * from 38 of 83 units to 42 of 83. These definitions freeze source rosters
 * only; they are not wired to a production importer until every identity,
 * route, destination cover, and route cover passes review.
 */
export const DOBIH_MAJORITY_FOUR_KEEPER_LISTS: KeeperListDefinition[] = [
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
      "England and Wales 2000-Foot Hill Register. This 316-hill roster comes from " +
      "DoBIH v18.5.",
    expectedCount: 316,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "Alan Dawson / LDWA Hillwalkers Register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "England and Wales",
  },
  {
    listId: deterministicKeeperListId("dobih:birketts"),
    sourceKey: "dobih-birketts",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "B=1 AND Country=E",
      rosterSha256: "970e671250616e38c0f9767acf26f058c7d2ebecd69568457512cfc25f9918d7",
    },
    name: "Birketts",
    description:
      "The Birketts are the 541 Lake District summits in Bill Birkett's Complete " +
      "Lakeland Fells. The LDWA Hillwalkers Register records completions, and this " +
      "roster comes from DoBIH v18.5.",
    expectedCount: 541,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "Bill Birkett / LDWA Hillwalkers Register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Lake District",
  },
  {
    listId: deterministicKeeperListId("dobih:synges"),
    sourceKey: "dobih-synges",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "Sy=1 AND Country=E",
      rosterSha256: "8d9bb012fea4f2c5135ff972c83d354b43f8706add77f125649527beb67acaff",
    },
    name: "Synges",
    description:
      "The Synges are the 670 Lake District summits in Tim Synge's current register. " +
      "The LDWA Hillwalkers Register records completions, and this roster comes from " +
      "DoBIH v18.5.",
    expectedCount: 670,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "Tim Synge / LDWA Hillwalkers Register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Lake District",
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
      "Alan Dawson's current register includes these 100 Great Britain Submarilyns. " +
      "This roster comes from DoBIH v18.5.",
    expectedCount: 100,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "Alan Dawson / Pedantic Press",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Great Britain",
  },
];
