import {
  deterministicKeeperListId,
  type KeeperListDefinition,
} from "../core";
import { DOBIH_V18_5_SOURCE } from "../sources";

const GENERATED_AT = "2026-08-30";
const SOURCES_SHA256 =
  "54ed97ccc6c4e5e831910ab3b4552360f980ca34249630755ad853e8d68c2402";
const SOURCE_NAME = "The Database of British and Irish Hills (CC BY 4.0)";
const SOURCE_URL = "https://www.hill-bagging.co.uk/dobih/downloads/";

export const DOBIH_OPEN_EIGHT_KEEPER_LISTS: KeeperListDefinition[] = [
  {
    listId: deterministicKeeperListId("dobih:munro-tops"),
    sourceKey: "dobih-munro-tops",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "MT=1",
      rosterSha256: "160fd59e3b4409919a7b5e70bfed265fa70a9bc62feb9743ae754ce198a5c65f",
    },
    name: "Munro Tops",
    description:
      "The Scottish Mountaineering Club recognizes these 226 Scottish summits above " +
      "3,000 feet as Munro Tops rather than separate Munros. The roster comes from " +
      "DoBIH v18.5.",
    expectedCount: 226,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "Scottish Mountaineering Club",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Scotland",
  },
  {
    listId: deterministicKeeperListId("dobih:furths"),
    sourceKey: "dobih-furths",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "F=1",
      rosterSha256: "020e054ab78d24151f4c16169acd847e63d6a6867d792b98148906ac2b3fae1d",
    },
    name: "Furths",
    description:
      "The Scottish Mountaineering Club lists these 34 peaks above 3,000 feet in " +
      "England, Wales, and Ireland as Furths. The roster comes from DoBIH v18.5.",
    expectedCount: 34,
    destinationOverrides: {},
    allowedCountryCodes: ["GB", "IE"],
    yearEstablished: null,
    organization: "Scottish Mountaineering Club",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "England, Wales, and Ireland",
  },
  {
    listId: deterministicKeeperListId("dobih:donalds"),
    sourceKey: "dobih-donalds",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "D=1 OR DT=1",
      rosterSha256: "a64c6bba2e79621fa08004bb28d1721259b0cd1f6dc0f7685935cb9b6290bfae",
    },
    name: "Donalds",
    description:
      "The Scottish Mountaineering Club keeps the Donalds and Donald Tops of the " +
      "Scottish Lowlands. This combined 141-peak roster comes from DoBIH v18.5.",
    expectedCount: 141,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "Scottish Mountaineering Club",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Scottish Lowlands",
  },
  {
    listId: deterministicKeeperListId("dobih:wainwright-outlying-fells"),
    sourceKey: "dobih-wainwright-outlying-fells",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "WO=1",
      rosterSha256: "5ffd1ed3e76a350203a27d57ded8f7b7ac354c0443547f63cb8a788cd30f4999",
    },
    name: "Wainwright's Outlying Fells",
    description:
      "Alfred Wainwright described these 116 Lake District outlying fells. The LDWA " +
      "Hillwalkers Register records completions, and the roster comes from DoBIH v18.5. " +
      "Peaks progress counts all 116 entries. The LDWA permits High Knott " +
      "(Williamson's Monument) to be omitted because access is prohibited.",
    expectedCount: 116,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "LDWA Hillwalkers Register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Lake District",
  },
  {
    listId: deterministicKeeperListId("dobih:fellrangers"),
    sourceKey: "dobih-fellrangers",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "Fel=1",
      rosterSha256: "f72a4325df13c1e3e4b5f3046b297e558e900441cad6a44637b017e9988d11c8",
    },
    name: "Fellrangers",
    description:
      "The Fellrangers are the 230 Lake District summits in the Fellranger guides. " +
      "The LDWA Hillwalkers Register records completions, and the roster comes from " +
      "DoBIH v18.5.",
    expectedCount: 230,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: null,
    organization: "LDWA Hillwalkers Register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Lake District",
  },
  {
    listId: deterministicKeeperListId("dobih:vandeleur-lynams"),
    sourceKey: "dobih-vandeleur-lynams",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "VL=1",
      rosterSha256: "c02ccde9dc1094bdc54262c0d336cff34805abbb2d6552d213cf45f8ebf4eee7",
    },
    name: "Vandeleur-Lynams",
    description:
      "MountainViews and Mountaineering Ireland recognize these 275 Irish mountains " +
      "at least 600 metres high with at least 15 metres of drop. The roster comes from " +
      "DoBIH v18.5.",
    expectedCount: 275,
    destinationOverrides: {},
    allowedCountryCodes: ["GB", "IE"],
    yearEstablished: null,
    organization: "MountainViews / Mountaineering Ireland",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Ireland",
  },
  {
    listId: deterministicKeeperListId("dobih:irish-2000-foot-register"),
    sourceKey: "dobih-irish-2000-foot-register",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "Hew=1 AND Country=I",
      rosterSha256: "cca6ca4c0a1a901b5038cc9cb1a7d80f759d42a0136b863a5e94542cf78bcbf4",
    },
    name: "Irish 2000-Foot Mountains",
    description:
      "The LDWA Hillwalkers Register and MountainViews recognize these 207 Irish " +
      "mountains above 2,000 feet with at least 30 metres of drop. The roster comes " +
      "from DoBIH v18.5.",
    expectedCount: 207,
    destinationOverrides: {},
    allowedCountryCodes: ["GB", "IE"],
    yearEstablished: null,
    organization: "LDWA Hillwalkers Register / MountainViews",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Ireland",
  },
  {
    listId: deterministicKeeperListId("dobih:grahams"),
    sourceKey: "dobih-grahams",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: GENERATED_AT,
      sourcesSha256: SOURCES_SHA256,
      selection: "G=1",
      rosterSha256: "57e27078f2ec8a323cc34521210d707eba817e3baf8297fa6dbb6971b0c298be",
    },
    name: "Grahams",
    description:
      "Alan Dawson and the Relative Hills Society keep the current 231 Grahams: " +
      "Scottish mountains at least 600 metres high with at least 100 metres of drop. " +
      "The Scottish Mountaineering Club kept the earlier register, and this roster " +
      "comes from DoBIH v18.5.",
    expectedCount: 231,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: 1992,
    organization:
      "Alan Dawson / Relative Hills Society; Scottish Mountaineering Club legacy register",
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    region: "Scotland",
  },
];
