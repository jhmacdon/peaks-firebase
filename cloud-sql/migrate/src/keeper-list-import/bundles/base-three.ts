import {
  deterministicKeeperListId,
  type KeeperListDefinition,
} from "../core";
import {
  DOBIH_V18_5_SOURCE,
  UIAA_BULLETIN_152_SOURCE,
} from "../sources";

export const BASE_THREE_KEEPER_LISTS: KeeperListDefinition[] = [
  {
    listId: deterministicKeeperListId("dobih:corbetts"),
    sourceKey: "dobih-corbetts",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: "2026-08-30",
      sourcesSha256: "8c38763ea4436f83dfb95ca96b51e74b1437419b2dee7d7e34c463489e885ce3",
      selection: "C=1",
      rosterSha256: "801bc61653fe7719dc1287c3ac6c9e1cfbe735efb1915afff53a8b464ca4b88a",
    },
    name: "Corbetts",
    description:
      "The Corbetts are the 222 Scottish peaks from 2,500 to 3,000 feet high with at least " +
      "500 feet of drop on every side. John Rooke Corbett drew up the first list, and the " +
      "Scottish Mountaineering Club now keeps it.",
    expectedCount: 222,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: 1952,
    organization: "Scottish Mountaineering Club",
    sourceName: "The Database of British and Irish Hills (CC BY 4.0)",
    sourceUrl: "https://www.hill-bagging.co.uk/dobih/downloads/",
    region: "Scotland",
  },
  {
    listId: deterministicKeeperListId("dobih:wainwrights"),
    sourceKey: "dobih-wainwrights",
    sourceDescriptor: DOBIH_V18_5_SOURCE,
    productionManifest: {
      generatedAt: "2026-08-30",
      sourcesSha256: "8c38763ea4436f83dfb95ca96b51e74b1437419b2dee7d7e34c463489e885ce3",
      selection: "W=1",
      rosterSha256: "7140cce0a84d66f149293294b1897e382cf1d82aa75c1823b48d55eb7611f562",
    },
    name: "Wainwrights",
    description:
      "Alfred Wainwright described these 214 Lake District fells in the seven volumes of his " +
      "Pictorial Guide to the Lakeland Fells. The Wainwright Society now keeps the completion " +
      "register for the 214. The list comes from the books, not from a height or drop rule.",
    expectedCount: 214,
    destinationOverrides: {},
    allowedCountryCodes: ["GB"],
    yearEstablished: 1966,
    organization: "The Wainwright Society",
    sourceName: "The Database of British and Irish Hills (CC BY 4.0)",
    sourceUrl: "https://www.hill-bagging.co.uk/dobih/downloads/",
    region: "Lake District",
  },
  {
    listId: deterministicKeeperListId("uiaa:pyrenees-main-3000ers"),
    sourceKey: "uiaa-pyrenees-main",
    sourceDescriptor: UIAA_BULLETIN_152_SOURCE,
    productionManifest: {
      generatedAt: "2026-08-30",
      sourcesSha256: "8c38763ea4436f83dfb95ca96b51e74b1437419b2dee7d7e34c463489e885ce3",
      selection: "main:001..main:129",
      rosterSha256: "ac47afa4687859971fa5e459738740c6336f8562df37186ee47de7650fc122f5",
    },
    name: "UIAA Pyrenees 3000ers",
    description:
      "The UIAA recognized 129 main Pyrenean summits at or above 3,000 meters in 1995. " +
      "The list separates those main peaks from 83 secondary summits and spans eleven " +
      "zones across France and Spain.",
    expectedCount: 129,
    destinationOverrides: {},
    allowedCountryCodes: ["ES", "FR"],
    yearEstablished: 1995,
    organization: "International Climbing and Mountaineering Federation (UIAA)",
    sourceName: "UIAA",
    sourceUrl: "https://www.theuiaa.org/3000-pyrenees/",
    region: "Pyrenees",
  },
];

export { BASE_THREE_KEEPER_LISTS as KEEPER_LISTS };
