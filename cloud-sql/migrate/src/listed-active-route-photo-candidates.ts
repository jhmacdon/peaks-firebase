export type RouteGapPhotoCoordinates = {
  lat: number;
  lng: number;
};

export type ReviewedRouteGapPhotoIdentity =
  | {
      type: "camera_coordinate";
      review: string;
    }
  | {
      type: "exact_peak";
      reviewedWikidataId: string;
      wikidataP18: boolean;
      commonsCategory: string | null;
      wikidataP18FileTitle: string | null;
      wikidataP18ResponseSha256: string | null;
      review: string;
    };

export type ReviewedRouteGapCommonsPhoto = {
  evidenceType: "reviewed_active_route_commons_file";
  destinationId: string;
  destinationName: string;
  countryCode: string | null;
  catalogWikidataId: string | null;
  catalogCoordinates: RouteGapPhotoCoordinates;
  catalogListIds: readonly string[];
  catalogListNames: readonly string[];
  catalogReviewHistoryFingerprint: string;
  fileTitle: string;
  sourcePageUrl: string;
  fileCoordinates: RouteGapPhotoCoordinates | null;
  fileCoordinateCount: number;
  photographer: string;
  licenseName: string;
  licenseUrl: string;
  width: number;
  height: number;
  mediaSha1: string;
  metadataSha256: string;
  identity: ReviewedRouteGapPhotoIdentity;
};

const EMPTY_REVIEW_HISTORY =
  '{"reviewCount":0,"sourcePageKeys":[],"mediaSha1s":[]}';

/**
 * Closed, human-reviewed Commons bindings for the listed active-route cover
 * priority batch. This is separate from the KFS-only reviewed file contract.
 */
export const LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES: Readonly<
  Record<string, Readonly<ReviewedRouteGapCommonsPhoto>>
> = Object.freeze({
  dg1agFR89EivHNOiFvbp: Object.freeze({
    evidenceType: "reviewed_active_route_commons_file",
    destinationId: "dg1agFR89EivHNOiFvbp",
    destinationName: "Mount Shuksan",
    countryCode: "US",
    catalogWikidataId: "Q1788022",
    catalogCoordinates: { lat: 48.831284, lng: -121.602849 },
    catalogListIds: ["DOlya3YYfIg60trgTm0n", "XHG0eHY8ePaltNO3dWs0"],
    catalogListNames: ["Bulger List", "Smoot's 100"],
    catalogReviewHistoryFingerprint: EMPTY_REVIEW_HISTORY,
    fileTitle: "File:Mount Shuksan tarn.jpg",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Mount_Shuksan_tarn.jpg",
    fileCoordinates: null,
    fileCoordinateCount: 0,
    photographer: "Frank Kovalchek from Anchorage, Alaska, USA",
    licenseName: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    width: 3_422,
    height: 2_217,
    mediaSha1: "32bc1530395e0fdffd118beaa211adce366b01ad",
    metadataSha256: "095ad10c9a4a82179e897845f7133619cb1b680dee3310b609dcf145091f3b7b",
    identity: {
      type: "exact_peak" as const,
      reviewedWikidataId: "Q1788022",
      wikidataP18: true,
      commonsCategory: "Category:Mount Shuksan",
      wikidataP18FileTitle: null,
      wikidataP18ResponseSha256: null,
      review: "The exact Wikidata item uses this file as P18, and the file is in the Mount Shuksan category",
    },
  }),
  "42aBrtB02YE3L8h4tTPo": Object.freeze({
    evidenceType: "reviewed_active_route_commons_file",
    destinationId: "42aBrtB02YE3L8h4tTPo",
    destinationName: "Granite Mountain",
    countryCode: "US",
    catalogWikidataId: "Q5595891",
    catalogCoordinates: { lat: 47.417727, lng: -121.481516 },
    catalogListIds: ["XHG0eHY8ePaltNO3dWs0", "grDJmpZ6mtpgtFY8X7i1"],
    catalogListNames: ["Smoot's 100", "Washington Home Court 100"],
    catalogReviewHistoryFingerprint: EMPTY_REVIEW_HISTORY,
    fileTitle: "File:Granite Mountain lookout - Flickr - brewbooks.jpg",
    sourcePageUrl:
      "https://commons.wikimedia.org/wiki/File:Granite_Mountain_lookout_-_Flickr_-_brewbooks.jpg",
    fileCoordinates: { lat: 47.417575, lng: -121.4812 },
    fileCoordinateCount: 1,
    photographer: "brewbooks from near Seattle, USA",
    licenseName: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
    width: 4_128,
    height: 3_096,
    mediaSha1: "639a4196d3b7d465b78039ffeb9645fb79de46bc",
    metadataSha256: "f1c5f2cab8940c2e0802e9d54ef50ac40f5615db685b0eb43228c6bf2645eba2",
    identity: {
      type: "camera_coordinate" as const,
      review: "The saved camera point is 29.2 m from the catalog summit and the original shows the summit lookout",
    },
  }),
  DJcLG4ln4RdHQ0zCEXxs: Object.freeze({
    evidenceType: "reviewed_active_route_commons_file",
    destinationId: "DJcLG4ln4RdHQ0zCEXxs",
    destinationName: "Kaleetan Peak",
    countryCode: "US",
    catalogWikidataId: "Q49040648",
    catalogCoordinates: { lat: 47.462526, lng: -121.47825 },
    catalogListIds: ["XHG0eHY8ePaltNO3dWs0", "grDJmpZ6mtpgtFY8X7i1"],
    catalogListNames: ["Smoot's 100", "Washington Home Court 100"],
    catalogReviewHistoryFingerprint: EMPTY_REVIEW_HISTORY,
    fileTitle: "File:Kaleetan Peak (from Abiel Peak).jpg",
    sourcePageUrl:
      "https://commons.wikimedia.org/wiki/File:Kaleetan_Peak_(from_Abiel_Peak).jpg",
    fileCoordinates: null,
    fileCoordinateCount: 0,
    photographer: "Martin Bravenboer",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    width: 7_555,
    height: 4_864,
    mediaSha1: "861dcbefb1d6a6870c396bd9ce1fe92d8b30fa38",
    metadataSha256: "98a71928e082213b0e8ab36b93995c2b5df8021ba7b956ba15f1e23eef91d0f3",
    identity: {
      type: "exact_peak" as const,
      reviewedWikidataId: "Q49040648",
      wikidataP18: false,
      commonsCategory: "Category:Kaleetan Peak",
      wikidataP18FileTitle: null,
      wikidataP18ResponseSha256: null,
      review: "The exact title and description name Kaleetan Peak and the file is in its exact Commons category",
    },
  }),
  nSf6z4vL0zjdG2sXibBM: Object.freeze({
    evidenceType: "reviewed_active_route_commons_file",
    destinationId: "nSf6z4vL0zjdG2sXibBM",
    destinationName: "Mount Si",
    countryCode: "US",
    catalogWikidataId: null,
    catalogCoordinates: { lat: 47.506807, lng: -121.739039 },
    catalogListIds: ["XHG0eHY8ePaltNO3dWs0"],
    catalogListNames: ["Smoot's 100"],
    catalogReviewHistoryFingerprint: EMPTY_REVIEW_HISTORY,
    fileTitle: "File:Mount Si seen from Mill Pond Road in Washington state.jpg",
    sourcePageUrl:
      "https://commons.wikimedia.org/wiki/File:Mount_Si_seen_from_Mill_Pond_Road_in_Washington_state.jpg",
    fileCoordinates: null,
    fileCoordinateCount: 0,
    photographer: "Ron Clausen",
    licenseName: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    width: 2_272,
    height: 1_638,
    mediaSha1: "66f87cbad2d06650931b77494cf90663115f9cdb",
    metadataSha256: "d8948f1cc48aa744b12016c1494a2b5e0dc31f05152f7192d94c9e1359bb86a8",
    identity: {
      type: "exact_peak" as const,
      reviewedWikidataId: "Q6923639",
      wikidataP18: false,
      commonsCategory: "Category:Mount Si",
      wikidataP18FileTitle: null,
      wikidataP18ResponseSha256: null,
      review:
        "The exact title and description name Mount Si and the file is in its exact Commons category",
    },
  }),
  "3Q1lVpAXWZFx146E6NUF": Object.freeze({
    evidenceType: "reviewed_active_route_commons_file",
    destinationId: "3Q1lVpAXWZFx146E6NUF",
    destinationName: "Mount Everest",
    countryCode: "NP",
    catalogWikidataId: "Q513",
    catalogCoordinates: { lat: 27.988257, lng: 86.925145 },
    catalogListIds: ["hPNDxe5mvtLjtlTnWlnf"],
    catalogListNames: ["The Seven Summits"],
    catalogReviewHistoryFingerprint: EMPTY_REVIEW_HISTORY,
    fileTitle: "File:Mount Everest as seen from Drukair2 PLW edit.jpg",
    sourcePageUrl:
      "https://commons.wikimedia.org/wiki/File:Mount_Everest_as_seen_from_Drukair2_PLW_edit.jpg",
    fileCoordinates: null,
    fileCoordinateCount: 0,
    photographer:
      "Mount_Everest_as_seen_from_Drukair2.jpg : shrimpo1967 derivative work: Papa Lima Whiskey 2 ( talk )",
    licenseName: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
    width: 2_971,
    height: 1_615,
    mediaSha1: "f3374ad94a12cd8143edc347d1b9bc11feee05d5",
    metadataSha256: "c4b721a2844adfd755718fb9687f08ed68bb61a0e02dea22a3dd725a664481a7",
    identity: {
      type: "exact_peak" as const,
      reviewedWikidataId: "Q513",
      wikidataP18: true,
      commonsCategory: "Category:Aerial photographs of Mount Everest",
      wikidataP18FileTitle: null,
      wikidataP18ResponseSha256: null,
      review: "The exact Wikidata item uses this file as P18 and the file directly names Mount Everest",
    },
  }),
  zntKOa5F6FjN6pzYadwv: Object.freeze({
    evidenceType: "reviewed_active_route_commons_file",
    destinationId: "zntKOa5F6FjN6pzYadwv",
    destinationName: "Snoqualmie Mountain",
    countryCode: "US",
    catalogWikidataId: "Q7548046",
    catalogCoordinates: { lat: 47.458988, lng: -121.416537 },
    catalogListIds: ["XHG0eHY8ePaltNO3dWs0", "grDJmpZ6mtpgtFY8X7i1"],
    catalogListNames: ["Smoot's 100", "Washington Home Court 100"],
    catalogReviewHistoryFingerprint: EMPTY_REVIEW_HISTORY,
    fileTitle: "File:Snoqualmie Mountain.jpg",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Snoqualmie_Mountain.jpg",
    fileCoordinates: null,
    fileCoordinateCount: 0,
    photographer: "J Brew",
    licenseName: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
    width: 3_264,
    height: 2_448,
    mediaSha1: "7585707fb29192a32722d1d9e87d589db1be0a73",
    metadataSha256: "8a90d76d35a954bfdb1f1f70cf10c00046e7df43c6b165c0e0414a8a322ed9ac",
    identity: {
      type: "exact_peak" as const,
      reviewedWikidataId: "Q7548046",
      wikidataP18: true,
      commonsCategory: null,
      wikidataP18FileTitle: "File:Snoqualmie Mountain.jpg",
      wikidataP18ResponseSha256:
        "2c2cb071a3219a0e86265018457bd70410f5c4712f6df260e5558e1ef11ee784",
      review: "The exact Wikidata item uses this file as P18 and the file title and description name Snoqualmie Mountain",
    },
  }),
});
