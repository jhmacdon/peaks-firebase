import type { Metadata } from "next";
import { AppScreenshots } from "../../../components/app-screenshots";
import DestinationCard from "../../../components/destination-card";
import RouteCard from "../../../components/route-card";
import { Button } from "../../../components/ui/button";
import { SectionHeading } from "../../../components/ui/section-heading";
import { CURATED_POPULAR_DESTINATIONS } from "../../../lib/constants";
import { getDestination } from "../../../lib/actions/destinations";
import { getPopularRoutes } from "../../../lib/actions/search";
import { settled } from "../../../lib/settled";
import { absoluteUrl } from "../../../lib/seo";

export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Explore, plan, and track with Peaks",
  description: "Find mountain routes, save places, plan trips with friends, and track your climbs with Peaks for iPhone.",
  alternates: { canonical: absoluteUrl("/features") },
};

export default async function FeaturesPage() {
  const [places, routes] = await Promise.all([
    Promise.all(CURATED_POPULAR_DESTINATIONS.slice(0, 3).map((entry) => settled(getDestination(entry.id), null))),
    settled(getPopularRoutes(3), []),
  ]);
  return <div className="mx-auto max-w-[1200px] space-y-14 px-6 py-10 md:space-y-20 md:py-16">
    <section className="grid items-center gap-10 lg:grid-cols-2">
      <div>
        <p className="text-sm font-medium text-accent-text">Peaks on the web and iPhone</p>
        <h1 className="font-display mt-3 max-w-[16ch] text-4xl font-bold leading-tight sm:text-5xl">From your next plan to your last summit.</h1>
        <p className="mt-5 max-w-[45ch] text-lg leading-relaxed text-ink-2">Find a place to climb, work out the route, and keep a record of the day. Browse and plan here, then record your activity with the iPhone app.</p>
        <div className="mt-6 flex flex-wrap gap-3"><Button href="/discover">Find a climb</Button><Button href="https://apps.apple.com/us/app/peaks-track-your-climb/id1497469000" variant="secondary" external>Get the iPhone app</Button></div>
      </div>
      <AppScreenshots />
    </section>
    <section>
      <SectionHeading size="lg">Find a place you want to go</SectionHeading>
      <p className="mt-3 max-w-[65ch] text-base text-ink-2">Search peaks, routes, parks, and lists. Narrow your search by region and activity, check the map, and save places for later. You can browse without an account.</p>
      <div className="mt-6 grid gap-5 sm:grid-cols-3">{places.filter((place) => place !== null).map((place) => <DestinationCard key={place.id} id={place.id} name={place.name} elevation={place.elevation} features={place.features} imageUrl={place.hero_image} imageAttribution={place.hero_image_attribution} imageAttributionUrl={place.hero_image_attribution_url} imageFocalX={place.hero_image_focal_x} imageFocalY={place.hero_image_focal_y} lat={place.lat} lng={place.lng} />)}</div>
    </section>
    <section>
      <SectionHeading size="lg">Make a trip from a route</SectionHeading>
      <p className="mt-3 max-w-[65ch] text-base text-ink-2">Check distance, elevation gain, and route shape, then add the route to a trip. Set a date, invite friends, and keep your stops and notes together.</p>
      <div className="mt-6 grid gap-5 sm:grid-cols-3">{routes.map((route) => <RouteCard key={route.id} route={route} />)}</div>
      <Button className="mt-6" href="/my-routes" variant="secondary">Your trips</Button>
    </section>
    <section className="grid gap-8 md:grid-cols-3">
      <div><SectionHeading>Record the day</SectionHeading><p className="mt-3 text-ink-2">Record a GPS track in the iPhone app, or import a GPX file on the web. Review your route, distance, elevation, and time in your activity log.</p><Button className="mt-4" href="/log" variant="quiet">Open your log →</Button></div>
      <div><SectionHeading>See your progress</SectionHeading><p className="mt-3 text-ink-2">See the places you’ve reached and your progress on peak lists. Use the remaining places to choose your next climb.</p><Button className="mt-4" href="/lists" variant="quiet">Explore lists →</Button></div>
      <div><SectionHeading>Share what you found</SectionHeading><p className="mt-3 text-ink-2">Add a trip report and photos to an activity. Let other climbers know about conditions and what helped your party.</p><Button className="mt-4" href="/reports/new" variant="quiet">Write a report →</Button></div>
    </section>
  </div>;
}
