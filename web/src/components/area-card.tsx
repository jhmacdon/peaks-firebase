import Link from "next/link";
import { areaKindLabel, type ProtectedArea } from "../lib/area-types";
import type { AreaCoverPhoto } from "../lib/area-cover-photo";
import { AreaKindIcon } from "./area-kind-icon";
import { Card } from "./ui/card";

export interface AreaCardData extends ProtectedArea {
  state_codes?: string[];
  destination_count?: number;
  route_count?: number;
  cover_photo?: AreaCoverPhoto | null;
}

export function AreaCard({
  area,
  typeLabel,
}: {
  area: AreaCardData;
  typeLabel?: string;
}) {
  const location = area.state_codes?.join(", ");
  const displayType = typeLabel ?? areaKindLabel(area.kind);
  const facts = [
    area.destination_count == null
      ? null
      : `${area.destination_count.toLocaleString("en-US")} ${
          area.destination_count === 1 ? "destination" : "destinations"
        }`,
    area.route_count == null
      ? null
      : `${area.route_count.toLocaleString("en-US")} ${
          area.route_count === 1 ? "route" : "routes"
        }`,
  ].filter((fact): fact is string => fact !== null);
  const href = `/areas/${encodeURIComponent(area.id)}`;

  const textContent = (
    <>
      <span className="block text-base font-medium leading-tight text-ink">
        {area.name}
      </span>
      <span className="mt-1 block text-sm text-muted">
        {[displayType, location].filter(Boolean).join(" · ")}
      </span>
      {facts.length > 0 && (
        <span className="mt-3 block text-sm text-muted">{facts.join(" · ")}</span>
      )}
    </>
  );

  if (area.cover_photo) {
    const credit = area.cover_photo.attribution;
    const creditClass =
      "max-w-[85%] truncate rounded-tl-md bg-black/65 px-2 py-1 text-[10px] leading-none text-white backdrop-blur-sm";

    return (
      <article className="group h-full overflow-hidden rounded-media border border-border bg-surface transition-colors hover:bg-fill">
        <figure className="relative">
          <Link href={href} className="block aspect-[16/9] overflow-hidden bg-fill">
            {/* The title below names the linked area, so the cover is decorative. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={area.cover_photo.imageUrl}
              alt=""
              className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
              style={{
                objectPosition: `${area.cover_photo.focalX}% ${area.cover_photo.focalY}%`,
              }}
            />
          </Link>
          {credit ? (
            <figcaption className="absolute right-0 bottom-0 flex max-w-full justify-end">
              {area.cover_photo.attributionUrl ? (
                <a
                  href={area.cover_photo.attributionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${creditClass} hover:underline`}
                  title={`Photo: ${credit}`}
                >
                  Photo: {credit}
                </a>
              ) : (
                <span className={creditClass} title={`Photo: ${credit}`}>
                  Photo: {credit}
                </span>
              )}
            </figcaption>
          ) : null}
        </figure>
        <Link href={href} className="block p-4">
          {textContent}
        </Link>
      </article>
    );
  }

  return (
    <Card href={href} className="h-full">
      <div className="flex items-start gap-3">
        {/* Neutral, not teal. The kind icon repeats on every card in the
            grid, and the accent budget (design-tokens.md law 4) does not
            stretch to a coloured tile per row. */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill text-ink-2">
          <AreaKindIcon area={area} className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          {textContent}
        </span>
      </div>
    </Card>
  );
}

export default AreaCard;
