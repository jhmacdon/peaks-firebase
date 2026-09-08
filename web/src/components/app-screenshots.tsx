import Image from "next/image";

const SCREENSHOTS = [
  { src: "/app/air-quality-map.jpg", alt: "Peaks for iPhone showing the Puget Sound map and regional air quality", title: "Explore the map", width: 736, height: 1600 },
  { src: "/app/year-in-review.png", alt: "Peaks for iPhone showing a year of hiking distance, elevation, and time", title: "See your progress", width: 368, height: 800 },
];

export function AppScreenshots({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-4 sm:gap-6">
        {SCREENSHOTS.map((shot) => <figure key={shot.src} className="mx-auto w-full max-w-[228px]">
          <Image src={shot.src} alt={shot.alt} width={shot.width} height={shot.height} sizes="(min-width: 640px) 228px, 44vw" className="h-auto w-full rounded-[24px] border border-border" />
          <figcaption className="mt-3 text-center text-sm font-medium text-ink">{shot.title}</figcaption>
        </figure>)}
      </div>
      <p className="mt-4 text-center text-xs text-muted">App previews. Map conditions shown are from August 2026.</p>
    </div>
  );
}
