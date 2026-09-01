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
      commonsCategoryResponseSha256?: string | null;
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
  imageUrl?: string;
  fileCoordinates: RouteGapPhotoCoordinates | null;
  fileCoordinateCount: number;
  photographer: string;
  licenseName: string;
  licenseUrl: string;
  width: number;
  height: number;
  mediaSha1: string;
  metadataSha256: string;
  catalogCoverFingerprint?: string;
  catalogActiveRouteFingerprint?: string;
  identity: ReviewedRouteGapPhotoIdentity;
};

export type StrictReviewedRouteGapCommonsPhoto =
  ReviewedRouteGapCommonsPhoto & {
    imageUrl: string;
    catalogCoverFingerprint: string;
    catalogActiveRouteFingerprint: string;
    identity: Extract<ReviewedRouteGapPhotoIdentity, { type: "exact_peak" }> & {
      commonsCategoryResponseSha256: string | null;
    };
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


/**
 * The next reviewed active-route cover batch. These rows may be outside the
 * current list catalog, but only their exact destination ids enter scope.
 */
export const NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES: Readonly<
  Record<string, Readonly<StrictReviewedRouteGapCommonsPhoto>>
> = Object.freeze({
  "YhxmMJE5KqAsa2jMYlrs": Object.freeze({
      "evidenceType": "reviewed_active_route_commons_file",
      "destinationId": "YhxmMJE5KqAsa2jMYlrs",
      "destinationName": "Mount Monadnock",
      "countryCode": "US",
      "catalogWikidataId": "Q289542",
      "catalogCoordinates": {
        "lat": 42.861117,
        "lng": -72.108292
      },
      "catalogListIds": [],
      "catalogListNames": [],
      "catalogReviewHistoryFingerprint": "{\"reviewCount\":0,\"sourcePageKeys\":[],\"mediaSha1s\":[]}",
      "fileTitle": "File:Mount Monadnock as seen from Bald Rock.jpg",
      "sourcePageUrl": "https://commons.wikimedia.org/wiki/File:Mount_Monadnock_as_seen_from_Bald_Rock.jpg",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/f/fb/Mount_Monadnock_as_seen_from_Bald_Rock.jpg",
      "fileCoordinates": {
        "lat": 42.853827,
        "lng": -72.107082
      },
      "fileCoordinateCount": 1,
      "photographer": "Jonwmcinenrey",
      "licenseName": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
      "width": 4288,
      "height": 2848,
      "mediaSha1": "3cfe7ffe8a1eb318e7c0dae1f677afa26a4572b1",
      "metadataSha256": "c241fe0baccc8505ebe9881443dbcbfa1211115bb3f5c5d72026d6cec83da212",
      "catalogCoverFingerprint": "{\"focalX\": 50, \"focalY\": 50, \"heroImageRaw\": null, \"heroImageAttributionRaw\": null, \"heroImageAttributionUrlRaw\": null}",
      "catalogActiveRouteFingerprint": "[{\"gainM\": 564.25390625, \"owner\": \"peaks\", \"status\": \"active\", \"routeId\": \"gZoKcidRFdBCNYMJC0xc\", \"distanceM\": 6275.222432825526, \"routeName\": \"Pumpelly Trail\", \"completion\": \"none\", \"destinationOrdinal\": 1, \"derivedCoverComplete\": false, \"linkedDestinationIds\": [\"H61azRSg0ZrtzaXJ42eC\", \"YhxmMJE5KqAsa2jMYlrs\"]}, {\"gainM\": 541.76171875, \"owner\": \"peaks\", \"status\": \"active\", \"routeId\": \"iufwHEWy2ZrAe7IIUAdW\", \"distanceM\": 2772.794337361321, \"routeName\": \"White Dot Trail\", \"completion\": \"none\", \"destinationOrdinal\": 1, \"derivedCoverComplete\": false, \"linkedDestinationIds\": [\"P0NlbaNGLy1HN5fohVv3\", \"YhxmMJE5KqAsa2jMYlrs\"]}]",
      "identity": {
        "type": "exact_peak",
        "reviewedWikidataId": "Q289542",
        "wikidataP18": true,
        "commonsCategory": null,
        "wikidataP18FileTitle": "File:Mount Monadnock as seen from Bald Rock.jpg",
        "wikidataP18ResponseSha256": "8de4663295a115403c8e2832e4ea0487c327abba7893f278db3a8b9c03e076f2",
        "commonsCategoryResponseSha256": null,
        "review": "The exact Wikidata item uses this file as P18; the title names Mount Monadnock and all three reviewed frames show its rocky dome"
      }
  } satisfies StrictReviewedRouteGapCommonsPhoto),
  "5hVnUW4tmqj3A6YbU0oB": Object.freeze({
      "evidenceType": "reviewed_active_route_commons_file",
      "destinationId": "5hVnUW4tmqj3A6YbU0oB",
      "destinationName": "Mailbox Peak",
      "countryCode": "US",
      "catalogWikidataId": "Q111944228",
      "catalogCoordinates": {
        "lat": 47.462465,
        "lng": -121.63942
      },
      "catalogListIds": [],
      "catalogListNames": [],
      "catalogReviewHistoryFingerprint": "{\"reviewCount\":0,\"sourcePageKeys\":[],\"mediaSha1s\":[]}",
      "fileTitle": "File:Mailbox from Mount Teneriffe.jpg",
      "sourcePageUrl": "https://commons.wikimedia.org/wiki/File:Mailbox_from_Mount_Teneriffe.jpg",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/d/d7/Mailbox_from_Mount_Teneriffe.jpg",
      "fileCoordinates": {
        "lat": 47.509269,
        "lng": -121.695022
      },
      "fileCoordinateCount": 1,
      "photographer": "Buidhe",
      "licenseName": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
      "width": 4624,
      "height": 3472,
      "mediaSha1": "6be2a3769288dc53bf6a6d4e63dc136367503877",
      "metadataSha256": "ae09b3f31c3dfbf2b46559b16a3f5f3b6c5ec1e76909129793e93adae6af2755",
      "catalogCoverFingerprint": "{\"focalX\": 50, \"focalY\": 50, \"heroImageRaw\": null, \"heroImageAttributionRaw\": null, \"heroImageAttributionUrlRaw\": null}",
      "catalogActiveRouteFingerprint": "[{\"gainM\": 1208.75390625, \"owner\": \"peaks\", \"status\": \"active\", \"routeId\": \"4gkUxiJyoPVyJWokOinE\", \"distanceM\": 4018.9009517120226, \"routeName\": \"Mailbox Peak Old Trail\", \"completion\": \"none\", \"destinationOrdinal\": 1, \"derivedCoverComplete\": false, \"linkedDestinationIds\": [\"GHg65nKUeQhQU3D9A7ie\", \"5hVnUW4tmqj3A6YbU0oB\"]}, {\"gainM\": 1329.16015625, \"owner\": \"peaks\", \"status\": \"active\", \"routeId\": \"KG89JzIf3B07ppaWjLxm\", \"distanceM\": 8251.016019616058, \"routeName\": \"Mailbox Peak Trail\", \"completion\": \"none\", \"destinationOrdinal\": 1, \"derivedCoverComplete\": false, \"linkedDestinationIds\": [\"GHg65nKUeQhQU3D9A7ie\", \"5hVnUW4tmqj3A6YbU0oB\"]}]",
      "identity": {
        "type": "exact_peak",
        "reviewedWikidataId": "Q111944228",
        "wikidataP18": false,
        "commonsCategory": "Category:Mailbox Peak",
        "wikidataP18FileTitle": null,
        "wikidataP18ResponseSha256": null,
        "commonsCategoryResponseSha256": "8bea08f2bc32aa068dfeb6ea50dd8e513dddc93123a989f0d7b3db2c515279a7",
        "review": "The exact title names Mailbox Peak, the file is in Category:Mailbox Peak, and all three reviewed frames keep the peak centered"
      }
  } satisfies StrictReviewedRouteGapCommonsPhoto),
  "30FBA25F6A12506D101B": Object.freeze({
      "evidenceType": "reviewed_active_route_commons_file",
      "destinationId": "30FBA25F6A12506D101B",
      "destinationName": "Barre des Écrins",
      "countryCode": "FR",
      "catalogWikidataId": "Q30480",
      "catalogCoordinates": {
        "lat": 44.92216,
        "lng": 6.359547
      },
      "catalogListIds": [],
      "catalogListNames": [],
      "catalogReviewHistoryFingerprint": "{\"reviewCount\":0,\"sourcePageKeys\":[],\"mediaSha1s\":[]}",
      "fileTitle": "File:La Barre des Écrins.jpg",
      "sourcePageUrl": "https://commons.wikimedia.org/wiki/File:La_Barre_des_%C3%89crins.jpg",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/e/e3/La_Barre_des_%C3%89crins.jpg",
      "fileCoordinates": null,
      "fileCoordinateCount": 0,
      "photographer": "Günter Seggebäing, Coesfeld, Germany",
      "licenseName": "CC BY-SA 3.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
      "width": 3648,
      "height": 2736,
      "mediaSha1": "d9269188bdef41c191224f7a1cf7f7eb92fe716c",
      "metadataSha256": "46ad429931253da93794cea4334d0eb3892dd4bdd86129f38922ba22243376fb",
      "catalogCoverFingerprint": "{\"focalX\": 50, \"focalY\": 50, \"heroImageRaw\": null, \"heroImageAttributionRaw\": null, \"heroImageAttributionUrlRaw\": null}",
      "catalogActiveRouteFingerprint": "[{\"gainM\": 2534.8000000000006, \"owner\": \"peaks\", \"status\": \"active\", \"routeId\": \"rB04wEqY2JQXh6QggSSf\", \"distanceM\": 12094, \"routeName\": \"Barre des Écrins via Normal West Ridge\", \"completion\": \"none\", \"destinationOrdinal\": 1, \"derivedCoverComplete\": false, \"linkedDestinationIds\": [\"B60AD3BB339C44E7BB05\", \"30FBA25F6A12506D101B\"]}]",
      "identity": {
        "type": "exact_peak",
        "reviewedWikidataId": "Q30480",
        "wikidataP18": true,
        "commonsCategory": null,
        "wikidataP18FileTitle": "File:La Barre des Écrins.jpg",
        "wikidataP18ResponseSha256": "d5d1f6ba67b3dd2ab59268674eb9070f72749f2b14a8fbefc8e4b78f89b0762d",
        "commonsCategoryResponseSha256": null,
        "review": "The exact Wikidata item uses this file as P18, and all three reviewed frames clearly show Barre des Écrins"
      }
  } satisfies StrictReviewedRouteGapCommonsPhoto),
  "2E5FFFF77936BBE3C5D7": Object.freeze({
      "evidenceType": "reviewed_active_route_commons_file",
      "destinationId": "2E5FFFF77936BBE3C5D7",
      "destinationName": "Gran Paradiso",
      "countryCode": "IT",
      "catalogWikidataId": "Q1372",
      "catalogCoordinates": {
        "lat": 45.5178193,
        "lng": 7.2672005
      },
      "catalogListIds": [],
      "catalogListNames": [],
      "catalogReviewHistoryFingerprint": "{\"reviewCount\":0,\"sourcePageKeys\":[],\"mediaSha1s\":[]}",
      "fileTitle": "File:Cogne gruppo gran paradiso (2).jpg",
      "sourcePageUrl": "https://commons.wikimedia.org/wiki/File:Cogne_gruppo_gran_paradiso_(2).jpg",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/f/fa/Cogne_gruppo_gran_paradiso_%282%29.jpg",
      "fileCoordinates": {
        "lat": 45.533333,
        "lng": 7.266667
      },
      "fileCoordinateCount": 1,
      "photographer": "Bramfab",
      "licenseName": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
      "width": 5472,
      "height": 3648,
      "mediaSha1": "2a1541e5bf44e7662799e41940728e078a1586c1",
      "metadataSha256": "38b2a56c6e4532cef258b6879ceb61ea2b5be88277871899594b8a4031d03553",
      "catalogCoverFingerprint": "{\"focalX\": 50, \"focalY\": 50, \"heroImageRaw\": null, \"heroImageAttributionRaw\": null, \"heroImageAttributionUrlRaw\": null}",
      "catalogActiveRouteFingerprint": "[{\"gainM\": 2234.699999999997, \"owner\": \"peaks\", \"status\": \"active\", \"routeId\": \"K7HlMn1qHI9gkPFd8kna\", \"distanceM\": 9411, \"routeName\": \"Gran Paradiso via Pont Normal Route\", \"completion\": \"none\", \"destinationOrdinal\": 1, \"derivedCoverComplete\": false, \"linkedDestinationIds\": [\"A17DB58D2952ED0446C3\", \"2E5FFFF77936BBE3C5D7\"]}]",
      "identity": {
        "type": "exact_peak",
        "reviewedWikidataId": "Q1372",
        "wikidataP18": false,
        "commonsCategory": "Category:Gran Paradiso",
        "wikidataP18FileTitle": null,
        "wikidataP18ResponseSha256": null,
        "commonsCategoryResponseSha256": "cd45c2dbbe7b993f9df3431a8bcde7ea732d6dec7e0fec6fef562fe5bed61323",
        "review": "The exact title and description identify Gran Paradiso, the file is in Category:Gran Paradiso, and all three reviewed frames preserve the group"
      }
  } satisfies StrictReviewedRouteGapCommonsPhoto),
  "6916E6CB5E5C45C02499": Object.freeze({
      "evidenceType": "reviewed_active_route_commons_file",
      "destinationId": "6916E6CB5E5C45C02499",
      "destinationName": "Chamechaude",
      "countryCode": "FR",
      "catalogWikidataId": "Q2321630",
      "catalogCoordinates": {
        "lat": 45.2876803,
        "lng": 5.7881527
      },
      "catalogListIds": [],
      "catalogListNames": [],
      "catalogReviewHistoryFingerprint": "{\"reviewCount\":0,\"sourcePageKeys\":[],\"mediaSha1s\":[]}",
      "fileTitle": "File:Chamechaude-depuis-la-pinea.jpg",
      "sourcePageUrl": "https://commons.wikimedia.org/wiki/File:Chamechaude-depuis-la-pinea.jpg",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/4/4d/Chamechaude-depuis-la-pinea.jpg",
      "fileCoordinates": null,
      "fileCoordinateCount": 0,
      "photographer": "Remontees",
      "licenseName": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
      "width": 5184,
      "height": 3888,
      "mediaSha1": "92f0bd26ba4df8fcfdc390c73a3164d33c6d16cf",
      "metadataSha256": "927979d36e1ec0979843faf78d521d56d2978e982c53d7ff33dc2c5ee5c04886",
      "catalogCoverFingerprint": "{\"focalX\": 50, \"focalY\": 50, \"heroImageRaw\": null, \"heroImageAttributionRaw\": null, \"heroImageAttributionUrlRaw\": null}",
      "catalogActiveRouteFingerprint": "[{\"gainM\": 796.1000000000004, \"owner\": \"peaks\", \"status\": \"active\", \"routeId\": \"8Bj0ryavUtKX4ekuNkKc\", \"distanceM\": 4068, \"routeName\": \"Chamechaude via Col de Porte\", \"completion\": \"none\", \"destinationOrdinal\": 1, \"derivedCoverComplete\": false, \"linkedDestinationIds\": [\"169808D1CD6E1D75D218\", \"6916E6CB5E5C45C02499\"]}]",
      "identity": {
        "type": "exact_peak",
        "reviewedWikidataId": "Q2321630",
        "wikidataP18": true,
        "commonsCategory": null,
        "wikidataP18FileTitle": "File:Chamechaude-depuis-la-pinea.jpg",
        "wikidataP18ResponseSha256": "ebb83d70eeff85719eca2be8b6c1be7e5f62d10deb0e25c7786d0f63e012adac",
        "commonsCategoryResponseSha256": null,
        "review": "The exact Wikidata item uses this file as P18, and all three reviewed frames clearly show Chamechaude"
      }
  } satisfies StrictReviewedRouteGapCommonsPhoto),
  "AFD21967E06AA9D81BA1": Object.freeze({
      "evidenceType": "reviewed_active_route_commons_file",
      "destinationId": "AFD21967E06AA9D81BA1",
      "destinationName": "Großglockner",
      "countryCode": "AT",
      "catalogWikidataId": "Q3388",
      "catalogCoordinates": {
        "lat": 47.0745464,
        "lng": 12.6938826
      },
      "catalogListIds": [],
      "catalogListNames": [],
      "catalogReviewHistoryFingerprint": "{\"reviewCount\":0,\"sourcePageKeys\":[],\"mediaSha1s\":[]}",
      "fileTitle": "File:Großglockner (Hochgasser).jpg",
      "sourcePageUrl": "https://commons.wikimedia.org/wiki/File:Gro%C3%9Fglockner_(Hochgasser).jpg",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/e/e9/Gro%C3%9Fglockner_%28Hochgasser%29.jpg",
      "fileCoordinates": {
        "lat": 47.15064,
        "lng": 12.5218
      },
      "fileCoordinateCount": 1,
      "photographer": "Jörg Braukmann",
      "licenseName": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
      "width": 7360,
      "height": 4912,
      "mediaSha1": "b804198321d27b29558551ac181cc3f6ebef095d",
      "metadataSha256": "d13e8f7f5234670cd93c3b1bdd225be944f08a37561b7c9680d89f99005608a8",
      "catalogCoverFingerprint": "{\"focalX\": 50, \"focalY\": 50, \"heroImageRaw\": null, \"heroImageAttributionRaw\": null, \"heroImageAttributionUrlRaw\": null}",
      "catalogActiveRouteFingerprint": "[{\"gainM\": 1913.4999999999993, \"owner\": \"peaks\", \"status\": \"active\", \"routeId\": \"0x4EiGAP5HchuDuliqtd\", \"distanceM\": 9113, \"routeName\": \"Großglockner via Lucknerhaus Normal Route\", \"completion\": \"none\", \"destinationOrdinal\": 1, \"derivedCoverComplete\": false, \"linkedDestinationIds\": [\"9A6A7F33A62D50654883\", \"AFD21967E06AA9D81BA1\"]}]",
      "identity": {
        "type": "exact_peak",
        "reviewedWikidataId": "Q3388",
        "wikidataP18": false,
        "commonsCategory": "Category:Großglockner",
        "wikidataP18FileTitle": null,
        "wikidataP18ResponseSha256": null,
        "commonsCategoryResponseSha256": "acbdb4fa3f311e8184eb6876747208f5d5b755c5e220ea3f711e83cb88161d14",
        "review": "The exact title and description identify Großglockner, the file is in Category:Großglockner, and all three reviewed frames preserve the summit"
      }
  } satisfies StrictReviewedRouteGapCommonsPhoto),
  "wDFtTKWGTP96rsoi2tNA": Object.freeze({
      "evidenceType": "reviewed_active_route_commons_file",
      "destinationId": "wDFtTKWGTP96rsoi2tNA",
      "destinationName": "Haleakala",
      "countryCode": null,
      "catalogWikidataId": null,
      "catalogCoordinates": {
        "lat": 20.709718,
        "lng": -156.253331
      },
      "catalogListIds": [],
      "catalogListNames": [],
      "catalogReviewHistoryFingerprint": "{\"reviewCount\":0,\"sourcePageKeys\":[],\"mediaSha1s\":[]}",
      "fileTitle": "File:Haleakalā, Peak Shadow.jpg",
      "sourcePageUrl": "https://commons.wikimedia.org/wiki/File:Haleakal%C4%81,_Peak_Shadow.jpg",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/8/80/Haleakal%C4%81%2C_Peak_Shadow.jpg",
      "fileCoordinates": null,
      "fileCoordinateCount": 0,
      "photographer": "belindah",
      "licenseName": "CC BY 2.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/2.0/",
      "width": 3604,
      "height": 2135,
      "mediaSha1": "e5c10f53a03ebacea39c439e9005035f02f45716",
      "metadataSha256": "750adcdef3432a8fecf638ee9813cd0f2a1256ba885a6e7ff1995067ecdf3fc2",
      "catalogCoverFingerprint": "{\"focalX\": 50, \"focalY\": 50, \"heroImageRaw\": null, \"heroImageAttributionRaw\": null, \"heroImageAttributionUrlRaw\": null}",
      "catalogActiveRouteFingerprint": "[{\"gainM\": 6.199999999999818, \"owner\": \"peaks\", \"status\": \"active\", \"routeId\": \"6E3lfeLCn8p5ekOQNVT8\", \"distanceM\": 109, \"routeName\": \"Haleakalā via Puʻuʻulaʻula Summit Trail\", \"completion\": \"none\", \"destinationOrdinal\": 1, \"derivedCoverComplete\": false, \"linkedDestinationIds\": [\"16A5041A156C538CEEB6\", \"wDFtTKWGTP96rsoi2tNA\"]}]",
      "identity": {
        "type": "exact_peak",
        "reviewedWikidataId": "Q515719",
        "wikidataP18": true,
        "commonsCategory": null,
        "wikidataP18FileTitle": "File:Haleakalā, Peak Shadow.jpg",
        "wikidataP18ResponseSha256": "0866e233730f99234b27449fe14428bdcef5cba35987970f4fc2aeebf8ca47ff",
        "commonsCategoryResponseSha256": null,
        "review": "The reviewed Wikidata item uses this file as P18, and all three reviewed frames preserve the Haleakalā crater landscape"
      }
  } satisfies StrictReviewedRouteGapCommonsPhoto),
  "lTBztUOvhj79YWPEtGGV": Object.freeze({
      "evidenceType": "reviewed_active_route_commons_file",
      "destinationId": "lTBztUOvhj79YWPEtGGV",
      "destinationName": "Middle Teton",
      "countryCode": "US",
      "catalogWikidataId": "Q2060335",
      "catalogCoordinates": {
        "lat": 43.729852,
        "lng": -110.811275
      },
      "catalogListIds": [],
      "catalogListNames": [],
      "catalogReviewHistoryFingerprint": "{\"reviewCount\":0,\"sourcePageKeys\":[],\"mediaSha1s\":[]}",
      "fileTitle": "File:Middle Teton Grand Teton NP1.jpg",
      "sourcePageUrl": "https://commons.wikimedia.org/wiki/File:Middle_Teton_Grand_Teton_NP1.jpg",
      "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/7/7b/Middle_Teton_Grand_Teton_NP1.jpg",
      "fileCoordinates": null,
      "fileCoordinateCount": 0,
      "photographer": "Acroterion",
      "licenseName": "CC BY-SA 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
      "width": 3464,
      "height": 2536,
      "mediaSha1": "b7adb7dcfd91eccb5d930fb7aea0974ec104b004",
      "metadataSha256": "12292fa8389aa6f0e7b4215a92f9cd6ccbc5b141ba4e0e2254d7cdf64c5c07e9",
      "catalogCoverFingerprint": "{\"focalX\": 50, \"focalY\": 50, \"heroImageRaw\": \"https://storage.googleapis.com/donner-a8608.appspot.com/destinations%2FlTBztUOvhj79YWPEtGGV.jpg\", \"heroImageAttributionRaw\": null, \"heroImageAttributionUrlRaw\": null}",
      "catalogActiveRouteFingerprint": "[{\"gainM\": 1901.1875, \"owner\": \"peaks\", \"status\": \"active\", \"routeId\": \"HY5RuRNroyNoHvVhaenc\", \"distanceM\": 10779.846286978594, \"routeName\": \"Southwest Couloir\", \"completion\": \"none\", \"destinationOrdinal\": 1, \"derivedCoverComplete\": false, \"linkedDestinationIds\": [\"Od1xhYmqvBKHLZoYjdBV\", \"lTBztUOvhj79YWPEtGGV\"]}]",
      "identity": {
        "type": "exact_peak",
        "reviewedWikidataId": "Q2060335",
        "wikidataP18": true,
        "commonsCategory": null,
        "wikidataP18FileTitle": "File:Middle Teton Grand Teton NP1.jpg",
        "wikidataP18ResponseSha256": "c0fbbcdfceafebfa5173cb48c3afad39e42235390a06c8221978dca57c1c0ae7",
        "commonsCategoryResponseSha256": null,
        "review": "The exact Wikidata item uses this file as P18, and all three reviewed frames clearly show Middle Teton"
      }
  } satisfies StrictReviewedRouteGapCommonsPhoto)
});

const ACTIVE_ROUTE_BATCH_OVERLAPS = Object.keys(
  NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES
).filter((destinationId) =>
  destinationId in LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES
);
if (ACTIVE_ROUTE_BATCH_OVERLAPS.length > 0) {
  throw new Error(
    "reviewed active-route cover batches overlap: " +
    ACTIVE_ROUTE_BATCH_OVERLAPS.sort().join(", ")
  );
}

export const ACTIVE_ROUTE_REVIEWED_COMMONS_FILES: Readonly<
  Record<string, Readonly<ReviewedRouteGapCommonsPhoto>>
> = Object.freeze({
  ...LISTED_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES,
  ...NEXT_ACTIVE_ROUTE_REVIEWED_COMMONS_FILES,
});
