import {
  deterministicKeeperListId,
  type KeeperListDefinition,
} from "../core";
import { KFS_100_FAMOUS_MOUNTAINS_SOURCE } from "../sources";

export const KFS_100_FAMOUS_MOUNTAINS_RESOLUTIONS_SHA256 =
  "d5159b66757dc205eab106a190e747261c4cf6ab3e934ddade77a21e6afe6d80";

export const KFS_100_FAMOUS_MOUNTAINS_KEEPER_LISTS: KeeperListDefinition[] = [{
  listId: deterministicKeeperListId("kfs:100-famous-mountains"),
  sourceKey: "kfs-100-famous-mountains",
  sourceDescriptor: KFS_100_FAMOUS_MOUNTAINS_SOURCE,
  productionManifest: {
    generatedAt: "2026-08-30",
    sourcesSha256: "1165478797e3e58287985fa9058b5d7645ef92460e43a9e9e59ba427438f304f",
    selection: "KFS official 100 Famous Mountains roster, 2022-01-01",
    rosterSha256: "ae12c4574d5fc99078aa0367cc88c4128ef102bb94d62ac74e65888cc4bee44b",
  },
  name: "Korea Forest Service 100 Famous Mountains",
  description:
    "The Korea Forest Service selected these 100 mountains for their scenery, " +
    "history, culture, ecology, and public interest. This roster follows the " +
    "official KFS list as of January 1, 2022.",
  expectedCount: 100,
  destinationOverrides: {},
  allowedCountryCodes: ["KR"],
  yearEstablished: 2002,
  organization: "Korea Forest Service",
  sourceName: "Korea Forest Service",
  sourceUrl:
    "https://www.forest.go.kr/kfsweb/kfi/kfs/foreston/main/contents/" +
    "FmmntSrch/selectFmmntSrchList.do?mn=AR02_02_05_01&orgId=fon&" +
    "mntIndex=1&mntUnit=100",
  region: "South Korea",
}];
