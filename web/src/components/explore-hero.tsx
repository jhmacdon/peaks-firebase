import Image from "next/image";
import Link from "next/link";
import { Button } from "./ui/button";

export function ExploreHero() {
  return (
    <section className="mx-auto max-w-[1440px] px-4 pt-4 sm:px-6 sm:pt-6">
      <div className="relative isolate overflow-hidden rounded-[24px] bg-[#243c40] px-5 py-14 text-white sm:px-10 sm:py-20 lg:py-28">
        <Image src="/seed/mount-rainier.jpg" alt="Snow-covered Mount Rainier above green mountain ridges" fill priority sizes="(min-width: 1440px) 1392px, 100vw" className="-z-20 object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/75 via-black/45 to-black/20" />
        <div className="mx-auto max-w-[1120px]">
          <p className="text-sm font-medium text-white/90">Your next mountain starts here</p>
          <h1 className="font-display mt-3 max-w-[14ch] text-[42px] font-bold leading-[1.05] tracking-tight sm:text-[58px] lg:text-[72px]">Find your next climb.</h1>
          <p className="mt-5 max-w-[45ch] text-lg leading-relaxed text-white/95">Explore peaks and routes, save places you want to go, and keep track of every summit.</p>
          <form action="/discover" role="search" className="mt-8 flex max-w-[640px] flex-col gap-2 rounded-[20px] bg-white p-2 sm:flex-row sm:rounded-full">
            <label htmlFor="home-search" className="sr-only">Search peaks, routes, and parks</label>
            <input id="home-search" name="q" type="search" placeholder="Search peaks, routes, and parks" className="h-12 min-w-0 flex-1 rounded-full bg-white px-4 text-base text-[#21211f] placeholder:text-[#64635e]" />
            <Button type="submit" className="shrink-0">Search</Button>
          </form>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            <Link href="/map" className="inline-flex min-h-11 items-center underline">Explore the map</Link>
            <Link href="/destinations/Tg5URBHkVwPA1gGKKB4Q" className="inline-flex min-h-11 items-center underline">Mount Rainier guide →</Link>
          </div>
        </div>
      </div>
      <p className="mt-2 text-right text-xs leading-5 text-muted">Photo: <a href="https://commons.wikimedia.org/wiki/File:Mount_Rainier_from_west.jpg" target="_blank" rel="noreferrer" className="underline">Stan Shebs / Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="license noreferrer" className="underline">CC BY-SA 3.0</a></p>
    </section>
  );
}
