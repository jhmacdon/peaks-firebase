export interface Guide {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  href: string;
  intro: string;
  sections: { title: string; paragraphs: string[]; source: { label: string; url: string } }[];
}

export const GUIDES: Guide[] = [
  {
    slug: "california-fire-lookouts",
    title: "California fire lookouts",
    subtitle: "Small rooms, long views, and a working life above the forest.",
    href: "/fire-lookouts/california",
    description: "Meet California’s fire lookouts through their mountain settings, the people who keep watch, and the paths and stairs that reach them.",
    intro: "At Buck Rock, a staircase climbs the side of a granite dome to a small room above the trees. There is space to stand outside and look a very long way. It is an appealing place to end a walk, but someone also comes here to work. That shared purpose gives California’s fire lookouts their particular charm: a visitor’s few minutes taking in the view may overlap with another person’s whole day of watching it.",
    sections: [
      {
        title: "A room built around a view",
        paragraphs: [
          "The earliest lookout stations could be little more than a platform in a tree or a tent on a high point. Permanent cabins followed. California’s network grew during the Civilian Conservation Corps years; the Forest Service records roughly 250 lookout towers built in the state between 1933 and 1942. Each one needed a useful view of the surrounding country.",
          "That practical choice still shapes a visit. Notice how little building there is beside all that open space, and how much of the country lies below the windows. The room had to serve a person who would stay after the hikers left. A lookout becomes more interesting when you give the building as much attention as the distant peaks.",
        ],
        source: { label: "Forest Service · California lookout history", url: "https://www.fs.usda.gov/media/121933" },
      },
      {
        title: "Above Idyllwild",
        paragraphs: [
          "Tahquitz Peak gives the story a southern California setting. Its lookout stands above Idyllwild in the San Jacinto Mountains, with views toward the Desert Divide and the country beyond. The South Ridge approach climbs toward it through a landscape where the forest and the drier slopes meet. The Forest Service describes summer mornings as the better time for this hot, dry walk.",
          "Let the approach be part of the attraction. A tower can catch your eye from a distance, then disappear behind the next turn. Reaching it on foot gives you time to notice the ground beneath it, the shape of the ridge, and why this particular high point made a useful place to watch for smoke.",
        ],
        source: { label: "Forest Service · San Jacinto hiking trails", url: "https://www.fs.usda.gov/media/132292" },
      },
      {
        title: "The people who keep them going",
        paragraphs: [
          "Buck Rock’s current building first housed a lookout in 1923. After years of closure, local volunteers worked with the Forest Service to repair it and bring it back into regular service in 2000. The Buck Rock Foundation still helps care for the place. The stairs, windows, and small living space survive because people continue to put time into them.",
          "At a staffed tower, you are visiting both a workplace and someone’s temporary home. Follow the host’s lead, leave room for the work, and check the lookout’s own visiting information before the drive. When a conversation is welcome, the person beside those windows may give you a much closer understanding of the view than a photograph can.",
        ],
        source: { label: "Buck Rock Foundation · The lookout and its history", url: "https://buckrock.org/buck-rock-lookout/" },
      },
    ],
  },
  {
    slug: "washington-fire-lookouts",
    title: "Washington fire lookouts",
    subtitle: "Ridge walks and the people who watched the Cascades.",
    href: "/fire-lookouts/washington",
    description: "Spend time with Washington’s fire lookouts, from Sun Top’s view of Rainier to the long approach and literary history of Desolation Peak.",
    intro: "A small building on a Washington ridge can change the way you look at the mountains around it. The summits become places a person had to learn well enough to spot a thin column of smoke among them. Walk up to a lookout and there are two things to get to know: the country outside, and the human life that once filled, or still fills, the room.",
    sections: [
      {
        title: "Rainier from Sun Top",
        paragraphs: [
          "Sun Top’s small cabin dates to the 1930s. It measures just fourteen feet on each side, with windows facing the surrounding country. Volunteers still spend the fire season here, and welcome visitors when the lookout is staffed. Rainier is the familiar presence in the view, but the room itself gives a closer sense of life on the summit.",
          "A road only reached the top in 1956. Before that, people brought supplies up by backpack or mule. Even an ordinary day of work depended on that uphill effort. The road makes a visit simpler now, though the gate may close when the lookout is unstaffed or parking is full. The volunteer association keeps the current visiting details.",
        ],
        source: { label: "Snoqualmie Fire Lookouts · Suntop Lookout", url: "https://www.snoqualmielookouts.org/suntop-lookout" },
      },
      {
        title: "Out along the ridge",
        paragraphs: [
          "Mount Fremont offers a different arrival. From Sunrise in Mount Rainier National Park, the route crosses meadows and follows rocky ridges toward a lookout built in the 1930s. Near Frozen Lake, the path turns toward the final ridge. Grand Park’s broad meadows lie north of the building; Rainier, the Cascades, and, in clear weather, the Olympics fill out the view.",
          "The Park Service lists the walk as 5.6 miles round trip. Much of its pleasure comes from staying high, where the terrain remains in sight as you move through it. The meadow plants grow slowly here, so keep to the trail and enjoy their small details from its edge. The lookout is a day destination; camping at or around it is prohibited.",
        ],
        source: { label: "National Park Service · Mount Fremont Lookout Trail", url: "https://www.nps.gov/mora/planyourvisit/mount-fremont-lookout.htm" },
      },
      {
        title: "A summer on Desolation",
        paragraphs: [
          "In 1956, Jack Kerouac worked as a fire lookout on Desolation Peak. His time there later appeared in Desolation Angels. The view includes the twin summits of Hozomeen, a striking neighbor to a small room in which a person might spend many hours alone. That history adds something to the visit whether or not you have read the book.",
          "Getting there takes more commitment than the name on a list might suggest. The steep trail rises above Ross Lake, with approaches involving the lake or a long walk along the East Bank Trail. Read the park’s route details before making plans. It is a place to allow time for: the climb, the open meadows, and a quiet pause beside the building.",
        ],
        source: { label: "National Park Service · Desolation Peak Trail", url: "https://www.nps.gov/noca/planyourvisit/desolation-peak-trail.htm" },
      },
    ],
  },
  {
    slug: "colorado-14ers",
    title: "Colorado 14ers",
    subtitle: "Beyond the last trees, a closer look at the high country.",
    href: "/lists/LAZcIKjluO0oT3o9g6MC",
    description: "Get to know Colorado’s fourteeners through the ground above treeline, the differences between routes, and the small details around a summit day.",
    intro: "There is a point on a Colorado mountain walk when the trees stop being the tallest things nearby. The sky takes up more of the view, the wind has less in its way, and even a small flower is worth a second look. Fourteen thousand feet gives these mountains a shared name. The interest lies in everything that makes a day on one different from a day on the next.",
    sections: [
      {
        title: "The number that starts the conversation",
        paragraphs: [
          "You will hear both 53 and 58 when people talk about Colorado’s fourteeners. The ranked list uses a 300-foot prominence rule: a summit must rise that far above the connecting saddle to higher ground. The longer list includes five named summits that do not meet that rule. It is a difference in how the peaks are counted, rather than a dispute about whether there is a mountain there.",
          "The names are more useful than the total when you begin to know the country. Two summits can share a ridge yet ask for quite different climbs. Keep the list as a way to find places that interest you, and give yourself room to return to a favorite. A second visit can tell you something the first one did not.",
        ],
        source: { label: "14ers.com · Peak rankings", url: "https://www.14ers.com/info_peak.php" },
      },
      {
        title: "Look down as well as out",
        paragraphs: [
          "In Rocky Mountain National Park, alpine tundra begins around 11,000 to 11,500 feet, depending on the slope’s exposure. Plants stay close to the ground, where they can shelter from the wind. Some take more than a year to form a flower bud before opening it during the short summer. A patch of flowers beside the trail deserves more than a passing glance.",
          "Some cushion plants resemble small clumps of moss. Others have fine hairs on their leaves and stems that help protect them from wind. Up close, the apparently bare ground becomes a place of varied shapes and colors. These plants are vulnerable to repeated footsteps, so the established trail is the place to see them from.",
        ],
        source: { label: "National Park Service · Alpine tundra", url: "https://www.nps.gov/romo/learn/nature/alpine_tundra_ecosystem.htm" },
      },
      {
        title: "Get to know one route",
        paragraphs: [
          "Longs Peak makes the limits of the shared label clear. Its Keyhole Route crosses narrow ledges, loose rock, and steep faces; the Park Service describes it as a climb. That is a very different undertaking from following a walking trail to a broad summit. Elevation alone tells you little about the skills, exposure, or time a route will demand.",
          "Choose a mountain you want to understand, then read the full route and current conditions, including the descent. Leave enough room in the day to turn around when the weather or your energy asks for it. The walk back is part of the outing, and a mountain can remain interesting long before, and long after, you stand on its highest rock.",
        ],
        source: { label: "National Park Service · Longs Peak’s Keyhole Route", url: "https://www.nps.gov/romo/planyourvisit/longspeak.htm" },
      },
    ],
  },
  {
    slug: "us-state-high-points",
    title: "US state high points",
    subtitle: "Fifty reasons to take a different road.",
    href: "/lists/dR9aHGKw3VwBhfsHSwlB",
    description: "An introduction to the varied places at the top of each state, from modest rises to mountain summits and the trips that connect them.",
    intro: "A state high point can give a familiar trip an unfamiliar turn. You leave the main road, pass through a town you would otherwise have missed, and arrive at a place whose claim is simply that everything else in the state lies lower. Sometimes the height is obvious. Sometimes a marker has to explain it. That variety is a large part of the pleasure.",
    sections: [
      {
        title: "Give the small rises their due",
        paragraphs: [
          "Florida’s Britton Hill stands 345 feet above sea level. Delaware’s Ebright Azimuth is another modest high point, while Connecticut’s highest ground lies on the south slope of Mount Frissell. A summit list can make you expect a sharp top and a wide view, but state boundaries and the shape of the land produce a much less tidy set of places.",
          "Let each visit be the size it wants to be. A short stop can still make you curious about the surrounding country: where the land rises next, why a road follows a particular line, or what grows on the slope. The less imposing high points offer a good excuse to pay attention to places that rarely appear in mountain photographs.",
        ],
        source: { label: "Highpointers Club · State highpoint guide", url: "https://highpointers.org/us-highpoint-guide/" },
      },
      {
        title: "An afternoon in the Black Mountains",
        paragraphs: [
          "North Carolina’s Mount Mitchell shows how much a single high point can hold. At 6,684 feet, it is the highest mountain east of the Mississippi. An observation deck gives a wide view when the weather is clear, and the surrounding state park offers trails for a longer visit. Clouds may shorten the view considerably; the cooler air still makes the height apparent.",
          "The observation deck and the trails offer different ways to spend an afternoon on the same mountain. One gives a quick sense of the surrounding country; the others let the visit unfold a little at a time. There is room in highpointing for both kinds of day, and for the towns and roads that connect them.",
        ],
        source: { label: "North Carolina State Parks · Mount Mitchell", url: "https://www.ncparks.gov/state-parks/mount-mitchell-state-park" },
      },
      {
        title: "A visit depends on a welcome",
        paragraphs: [
          "Several state high points sit on private land. Others fall within parks or forests with their own visiting arrangements. The Highpointers Club keeps access notes because permission, opening dates, and the way in matter as much as a point’s position on the map. A small hill can require more advance thought than its elevation suggests.",
          "Read those arrangements before adding a detour, and follow the landowner’s or land manager’s current instructions. Then keep a few notes of your own: who came along, what the weather did, and what caught your attention. Over time, those details make a much richer record than a row of completed states. There is no need to hurry the next one.",
        ],
        source: { label: "Highpointers Club · Access notes", url: "https://highpointers.org/access-restrictions/" },
      },
    ],
  },
  {
    slug: "cascade-volcanoes",
    title: "Cascade volcanoes",
    subtitle: "Snow, ice, and the ground that grew beneath them.",
    href: "/lists/ULCGhLnsWcYYRqXQ3aOo",
    description: "Look more closely at the Cascade volcanoes, from their long geographic reach to Rainier’s glaciers and the lakes inside Newberry.",
    intro: "A Cascade volcano can be familiar long before you set foot on it. You recognize its outline from a road, notice when fresh snow reaches lower on its slopes, and look for it again when the clouds lift. A closer visit adds details to that distant shape. The ice, loose stone, forests, and lakes belong to mountains with long histories that are still unfolding.",
    sections: [
      {
        title: "A long stretch of volcanic country",
        paragraphs: [
          "The volcanic arc extends about 800 miles from northern California into southern British Columbia. Beneath it, oceanic crust moves below North America, helping generate the magma that feeds the volcanoes. The familiar large mountains share the region with thousands of smaller volcanic features. There is more volcanic country between the famous summits than a short climbing list can show.",
          "That wide spread makes it rewarding to get to know one part of the range at a time. Notice the smaller hills and old flows as well as the tallest peak. A view from a neighboring ridge can reveal the mountain’s shape more clearly than a climb on its own slopes, where the next bend may hide almost everything above you.",
        ],
        source: { label: "USGS · The Cascade volcanic arc", url: "https://www.usgs.gov/observatories/cascades-volcano-observatory/why-study-cascade-volcanoes" },
      },
      {
        title: "Rainier’s ice has names",
        paragraphs: [
          "The white on Mount Rainier resolves into separate glaciers when you look closely. Carbon, Emmons, Nisqually, and the others occupy different sides of the mountain and have their own shapes and histories. The Park Service’s glacier guide describes where to see them. Learning just one name gives you something specific to look for on the next clear day.",
          "Seasonal snow can hide the boundaries between ice and rock, then reveal them again as it melts. A familiar view becomes easier to read with each return: a dark ridge between glaciers, a valley below, a section of ice that was less apparent last time. The mountain’s many sides give even a distant observer plenty to get to know.",
        ],
        source: { label: "National Park Service · Mount Rainier’s glaciers", url: "https://www.nps.gov/mora/learn/nature/mount-rainier-glaciers.htm" },
      },
      {
        title: "A volcano with lakes inside",
        paragraphs: [
          "Newberry, in central Oregon, invites a different sort of attention. Paulina Lake and East Lake occupy a caldera, a broad depression formed when the summit collapsed during an eruption. From Paulina Peak, the lakes sit below the rim alongside younger volcanic features. The mostly bare Big Obsidian Flow stands out against the surrounding forest.",
          "Here, a lake visit can also be a way to get to know a volcano. Water, trees, and old lava belong to the same place; the quiet appearance does not mean its volcanic history has ended. Use the land manager’s current information for walks and access, and USGS for the geology. Following that curiosity can lead well beyond the few high summits that first caught your eye.",
        ],
        source: { label: "USGS · Features of Newberry Caldera", url: "https://www.usgs.gov/volcanoes/newberry/science/features-newberry-caldera" },
      },
    ],
  },
  {
    slug: "washington-waterfalls",
    title: "Washington waterfalls",
    subtitle: "Forest paths, river noise, and falls in open canyon country.",
    href: "/guides/washington-waterfalls",
    description: "Follow Washington’s water through the forest at Wallace Falls, the living history of Snoqualmie Falls, and the basalt canyon at Palouse Falls.",
    intro: "You can plan a walk around a waterfall, but it helps to leave time for the river on either side of it. Watch the water gather above the drop and find its course again below. The falls may be the reason you came; the banks, trees, and rock explain more about the place. Across Washington, those surroundings change as much as the waterfalls themselves.",
    sections: [
      {
        title: "Follow the river at Wallace Falls",
        paragraphs: [
          "At Wallace Falls, near Gold Bar, the trail follows the Wallace River through forest toward a series of viewpoints. Lower, middle, and upper stops break up the climb. From the middle viewpoint, the view opens across the Skykomish River Valley, so there is good reason to pause even when you intend to keep walking uphill.",
          "Choose your stopping place by the kind of day you want. One viewpoint and an unhurried return can be enough. The river gives the walk a steady point of interest, while the trees make the occasional open view feel more distinct. Washington State Parks publishes trail and parking information; a look before leaving helps keep the start of the day as pleasant as the walk.",
        ],
        source: { label: "Washington State Parks · Wallace Falls", url: "https://parks.wa.gov/find-parks/state-parks/wallace-falls-state-park" },
      },
      {
        title: "Listen at Snoqualmie Falls",
        paragraphs: [
          "Snoqualmie Falls has a meaning that reaches far beyond its familiar photograph. The Snoqualmie Tribe identifies the falls as the birthplace of its people and describes an enduring connection to the site and to its ancestors. This is a living relationship. Reading the Tribe’s own account adds something essential to a visit that a measurement of the drop cannot provide.",
          "The Tribe describes itself as the spiritual steward of the falls and continues to work for their protection. The people in that account are part of the place today. Beside the sound and movement of the water, their words give a visitor something else to remember: the long care that a familiar view can depend on.",
        ],
        source: { label: "Snoqualmie Indian Tribe · Sacred Snoqualmie Falls", url: "https://snoqualmietribe.us/history-shared-sacred-snoqualmie-falls/" },
      },
      {
        title: "Water through basalt",
        paragraphs: [
          "Palouse Falls introduces another Washington landscape. The river drops into a deep canyon cut through layers of basalt, then continues toward the Snake River. Ice Age floods shaped this country on a scale far larger than the river visible today. From the overlooks, the falls give you a place to begin tracing the cliffs and the winding canyon beyond.",
          "The canyon’s width makes the present river seem small. Its dark rock layers continue beyond the immediate drop, so the waterfall is only one part of the view from the designated overlooks. The park’s interpretive signs explain how the floods cut this country. A few minutes with that history can make the scale much easier to grasp.",
        ],
        source: { label: "Washington State Parks · The Ice Age floods", url: "https://parks.wa.gov/about/news-center/field-guide-blog/how-ice-age-floods-shaped-washington-state" },
      },
    ],
  },
  {
    slug: "alpine-lakes-wilderness",
    title: "Alpine Lakes Wilderness",
    subtitle: "A lake for the afternoon, and more country beyond the ridge.",
    href: "/areas/padus-24a96d99fe35fa744ba1",
    description: "Get to know Alpine Lakes through its valleys, varied approaches, and the pleasure of spending more time at one lake.",
    intro: "The first glimpse of a lake through the trees can settle the question of how far to walk that day. You find the shore, look up at the ridge above it, and realize there is plenty to take in right here. Alpine Lakes Wilderness holds enough lakes and high country for many returns. A good first visit can be as simple as getting to know one approach and one stretch of water.",
    sections: [
      {
        title: "The way in shapes the day",
        paragraphs: [
          "At the northern edge of the wilderness, the Pacific Crest Trail heads south from Stevens Pass toward Lake Susan Jane. The walk begins among the slopes and lifts of a ski area before reaching the lake. It is a useful reminder that the approach has its own character: the first mile and the last do not have to look alike.",
          "Choose a trailhead as carefully as a destination. Follow the actual trail across the map, including each climb and descent, rather than judging the trip by the distance between two lakes. A ridge can put nearby water in a different valley altogether. Familiarity with one approach is valuable; returning on it lets you notice more and spend less of the day wondering what comes next.",
        ],
        source: { label: "Pacific Crest Trail Association · Lake Susan Jane", url: "https://explore.pcta.org/trips/stevens-pass-to-lake-susan-jane" },
      },
      {
        title: "Leave room around the Enchantments",
        paragraphs: [
          "The Enchantments draw many visitors into the eastern part of Alpine Lakes. Stuart Lake, Eightmile, and Snow Lakes are among the busy trailheads off Icicle Road. The Forest Service has studied these approaches because crowds affect both the experience and the ground people come to see. A famous lake exists within a much larger area, with other valleys and other reasons to return.",
          "If the Enchantments are the place you want to know, give the trip the time and planning it needs. If you mainly want a day beside a mountain lake, let that simpler wish guide the choice. There is pleasure in learning an ordinary bend in the trail, finding the same ridge in a new light, and remembering where the water first came into view.",
        ],
        source: { label: "Forest Service · Enchantments visitor study", url: "https://research.fs.usda.gov/treesearch/80472" },
      },
      {
        title: "Make a small visit",
        paragraphs: [
          "The Forest Service asks visitors to protect water quality, avoid restoration areas, and leave natural features as they find them. Permit arrangements distinguish the Enchantments from the rest of the wilderness, so check the rules for your actual destination before leaving. Once those details are settled, the day can be about the walk and the place itself.",
          "From an established stopping place, the same stretch of shore offers a changing view. A breeze roughens the water; a passing cloud darkens the ridge and its reflection. The path back has details that went unnoticed on the way in. By the end of the day, one lake and its approach can feel like a place you have begun to know.",
        ],
        source: { label: "Forest Service · Alpine Lakes visitor leaflet", url: "https://www.fs.usda.gov/media/176886" },
      },
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
