export interface Guide {
  slug: string;
  title: string;
  description: string;
  href: string;
  intro: string;
  sections: { title: string; paragraphs: string[]; source: { label: string; url: string } }[];
}

export const GUIDES: Guide[] = [
  {
    slug: "colorado-14ers", title: "Colorado 14ers: map and peak list",
    href: "/lists/LAZcIKjluO0oT3o9g6MC",
    description: "Find Colorado’s 14ers on a map, compare summit elevations, and understand the difference between ranked and unranked peaks.",
    intro: "A list of Colorado’s 14ers is a good way to learn the state’s mountain ranges. Nearby summits often share an approach, while peaks that look close on a map can sit across a long drive. Start with the map, pick a part of the state, then look at the route to each summit.",
    sections: [
      { title: "Why do some lists say 53 and others 58?", paragraphs: ["The difference is prominence: how far a summit rises above the saddle that connects it to higher ground. The ranked list uses a 300-foot cutoff. The longer list also includes named summits that fall short of that cutoff. Both appear in climbing guides, so compare the actual names before comparing your total with someone else’s.", "Use the roster below to see which peaks this list includes. A count on its own does not tell you which convention a list follows."], source: { label: "14ers.com’s explanation of peak rankings", url: "https://www.14ers.com/info_peak.php" } },
      { title: "Choose a route, then a summit", paragraphs: ["Two peaks above 14,000 feet can call for very different days. Read the route description before choosing by elevation or proximity. Look at the starting point, total ascent, terrain, and descent—not just the summit pin.", "A route map also helps with the less memorable parts of planning: which road reaches the trailhead, where the walk begins, and whether the return follows the same path. Keep those details with the peak you intend to climb."], source: { label: "Colorado 14er route descriptions", url: "https://www.14ers.com/routes.php" } },
    ],
  },
  {
    slug: "us-state-high-points", title: "US state high points: map and checklist",
    href: "/lists/dR9aHGKw3VwBhfsHSwlB",
    description: "Explore the US state high points, from short walks to major climbs. Use the map and checklist to plan visits and track your progress.",
    intro: "Visiting each state’s highest point gives you a reason to stop in places you might otherwise drive past. Some visits fit into an afternoon. Others need a trip of their own. The same checklist can take you to roadside markers and remote summits.",
    sections: [
      { title: "Start with the states you already visit", paragraphs: ["Look for high points near a trip you already have planned. Grouping visits by region can make more sense than working down a list by elevation. Open each place before adding it to the itinerary: the highest ground in a state is not always a public park with an open gate.", "The Highpointers Club’s guide separates access and difficulty from elevation. That distinction matters here, where one checklist covers both short visits and mountaineering trips."], source: { label: "Highpointers Club’s US highpoint guide", url: "https://highpointers.org/us-highpoint-guide/" } },
      { title: "Check access for the day you plan to go", paragraphs: ["Some high points have restricted visiting dates or require permission. Public land can also have opening hours, permits, or quotas. Check the current arrangement before setting out, especially when a high point means a long detour.", "Keep a record of the places you visit, but let each trip stand on its own. Finishing the list need not be the reason to enjoy the next one."], source: { label: "Highpointers Club access restrictions", url: "https://highpointers.org/access-restrictions/" } },
    ],
  },
  {
    slug: "cascade-volcanoes", title: "Cascade volcanoes: map and summit list",
    href: "/lists/ULCGhLnsWcYYRqXQ3aOo",
    description: "Locate the Cascade volcanoes, compare their summits, and follow links to place and route guides across the range.",
    intro: "The Cascade volcanoes run from northern California into British Columbia. Seeing them together on a map makes the geography clearer: these are separate mountains spread along a long range, not one compact group of climbs. Use this list to get your bearings and choose a mountain to read about next.",
    sections: [
      { title: "A climbing list is only part of the volcanic range", paragraphs: ["The familiar high summits are not the whole story. USGS describes thousands of volcanic features in the Cascades, including smaller cones and broad volcanic fields. A summit checklist selects particular mountains; it is not a complete inventory of the region’s volcanoes.", "The roster below defines this Peaks list. For the wider geography, compare it with the USGS map of the Cascade volcanic arc."], source: { label: "USGS map of the Cascade volcanic arc", url: "https://www.usgs.gov/media/images/map-cascade-volcano-arc" } },
      { title: "Plan one mountain at a time", paragraphs: ["Sharing a volcanic origin does not make these mountains interchangeable. Pick a specific route and season before deciding what a trip involves. A summit marker tells you where the mountain is; it does not tell you how to climb it.", "USGS volcano information answers a different question from a climbing guide. Use it to understand the mountain’s volcanic setting, then consult the land manager and a route source for access and trip planning."], source: { label: "USGS: why study Cascade volcanoes?", url: "https://www.usgs.gov/observatories/cascades-volcano-observatory/why-study-cascade-volcanoes" } },
    ],
  },
  {
    slug: "washington-waterfalls", title: "Washington waterfalls map",
    href: "/guides/washington-waterfalls",
    description: "Find Washington waterfalls on a map, browse named falls, and choose between a viewpoint stop and a longer walk.",
    intro: "A waterfall trip can be a short stop at a viewing platform or the reason for a full day on foot. Decide which sort of day you want before picking the falls. The map below helps you find places in the same area; each place guide is the next step toward working out how to reach them.",
    sections: [
      { title: "A viewpoint stop or a day on the trail?", paragraphs: ["Snoqualmie Falls has viewing platforms in a small park. Wallace Falls offers a different kind of visit, with viewpoints along the trail and views across the Skykomish valley from the Middle Falls. These are useful starting points when deciding whether the waterfall is a stop along the way or the main purpose of the day.", "For other falls, check the approach before drawing up an itinerary. A mapped waterfall may have no public trail to its base. The closest road on the map is not necessarily the way in."], source: { label: "Washington DNR’s Wallace Falls guide", url: "https://wa100.dnr.wa.gov/north-cascades/wallace-falls" } },
      { title: "Water changes the view", paragraphs: ["At Snoqualmie Falls, DNR records much higher flows during rainy periods and spring snowmelt than in late summer. That is one reason photographs of the same falls can look so different. Check when a photograph or trip report was made before using it to picture your visit.", "The map shows waterfall locations in Peaks, not a complete inventory or a list of open trails. Elevation, where shown in a place guide, refers to the location above sea level—not the waterfall’s drop."], source: { label: "Washington DNR’s Snoqualmie Falls guide", url: "https://wa100.dnr.wa.gov/north-cascades/snoqualmie-falls" } },
    ],
  },
  {
    slug: "alpine-lakes-wilderness", title: "Alpine Lakes Wilderness: hikes, lakes, and map",
    href: "/areas/padus-24a96d99fe35fa744ba1",
    description: "Get your bearings in Alpine Lakes Wilderness. Compare destinations and routes, choose an approach, and find the right permit information.",
    intro: "Start an Alpine Lakes trip with the trailhead, not just the lake. A ridge between two places can change the approach completely. Use the map to see which valley a route follows, then decide how far into the wilderness you want to go and whether you will return the same way.",
    sections: [
      { title: "Choose an approach before a destination", paragraphs: ["The wilderness has several entry points. The Pacific Crest Trail provides access from Stevens Pass; the Middle Fork Snoqualmie reaches a different part of the area. On the east side, Stuart Lake, Eightmile, and Snow Lakes are among the trailheads serving the Enchantments area.", "Compare routes from their actual starting points. A lake that sits close to another lake on the map may require a different trailhead or a crossing that is not part of a walking trail."], source: { label: "Forest Service study of the Enchantments trailheads", url: "https://research.fs.usda.gov/treesearch/80472" } },
      { title: "Do not treat the Enchantments as the whole wilderness", paragraphs: ["The Enchantments have their own permit arrangements. A plan to camp there needs a separate check from a day walk elsewhere in Alpine Lakes. Read the rules for the place you intend to visit, rather than applying advice for one lake to the whole area.", "The Forest Service’s wilderness leaflet brings together the different rules, including where to find permit information. Check the managing forest’s current notices as well: a saved map or an older trip report will not tell you about a new closure."], source: { label: "Forest Service Alpine Lakes Wilderness visitor leaflet", url: "https://www.fs.usda.gov/Internet/FSE_DOCUMENTS/stelprdb5407053.pdf" } },
    ],
  },
];

export function guideForList(id: string): Guide | undefined {
  return GUIDES.find((guide) => guide.href === `/lists/${id}`);
}
export function guideForArea(name: string, country: string, states: string[]): Guide | undefined {
  return name === "Alpine Lakes Wilderness" && country === "US" && states.includes("WA")
    ? GUIDES.find((guide) => guide.slug === "alpine-lakes-wilderness") : undefined;
}
