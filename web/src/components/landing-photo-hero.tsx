import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

const MOUNT_RAINIER_GUIDE = "/destinations/Tg5URBHkVwPA1gGKKB4Q";
const MOUNT_RAINIER_SOURCE =
  "https://commons.wikimedia.org/wiki/File:Mount_Rainier_from_west.jpg";
const MOUNT_RAINIER_LICENSE =
  "https://creativecommons.org/licenses/by-sa/3.0/";

interface LandingPhotoHeroProps {
  eyebrow: string;
  title: string;
  description: ReactNode;
  actions: ReactNode;
  afterActions?: ReactNode;
}

/**
 * The shared lead visual for Peaks' broad product and state-guide pages.
 *
 * This is the existing Peaks repo cover used by local catalog data.
 * Keep the source and license links with it if the photo or layout moves.
 */
export function LandingPhotoHero({
  eyebrow,
  title,
  description,
  actions,
  afterActions,
}: LandingPhotoHeroProps) {
  return (
    <section>
      <div className="mx-auto grid max-w-[1200px] items-center gap-8 px-6 py-10 md:gap-12 md:py-20 lg:grid-cols-[minmax(0,0.88fr)_minmax(440px,1.12fr)] lg:gap-16 lg:py-24">
        <div>
          <p className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">
            {eyebrow}
          </p>
          <h1 className="font-display mt-4 max-w-[15ch] text-[38px] leading-[1.02] font-[680] tracking-[-0.018em] text-ink sm:text-[48px] lg:text-[64px]">
            {title}
          </h1>
          <p className="mt-6 max-w-[50ch] text-[18px] leading-[1.6] text-ink-2">
            {description}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            {actions}
          </div>
          {afterActions ? (
            <div className="mt-10 hidden sm:block">{afterActions}</div>
          ) : null}
        </div>

        <figure className="min-w-0">
          <Link
            href={MOUNT_RAINIER_GUIDE}
            className="group relative block aspect-[3/2] overflow-hidden rounded-media bg-fill"
            aria-label="Open the Mount Rainier guide"
          >
            <Image
              src="/seed/mount-rainier.jpg"
              alt="Aerial view of snow-covered Mount Rainier from the west"
              fill
              priority
              sizes="(min-width: 1200px) 600px, (min-width: 1024px) 48vw, calc(100vw - 48px)"
              className="object-cover"
            />
            <span className="photo-credit absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 px-5 pt-16 pb-5 sm:px-6 sm:pb-6">
              <span>
                <span className="block text-[11px] font-medium tracking-[0.14em] uppercase opacity-80">
                  Featured guide
                </span>
                <span className="mt-1 block text-[20px] leading-tight font-medium">
                  Mount Rainier
                </span>
              </span>
              <span className="shrink-0 text-[13px] font-medium opacity-90 group-hover:underline">
                Open guide →
              </span>
            </span>
          </Link>
          <figcaption className="mt-2.5 text-[11px] leading-5 text-muted">
            Photo: {" "}
            <a
              href={MOUNT_RAINIER_SOURCE}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              Stan Shebs / Wikimedia Commons
            </a>{" "}
            · {" "}
            <a
              href={MOUNT_RAINIER_LICENSE}
              target="_blank"
              rel="license noreferrer"
              className="hover:underline"
            >
              CC BY-SA 3.0
            </a>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
