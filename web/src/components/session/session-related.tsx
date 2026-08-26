import Link from "next/link";
import type { SessionDestination, SessionRoute } from "../../lib/actions/sessions";
import { sortAreasByProminence, type ProtectedArea } from "../../lib/area-types";
import { AreaChip } from "../area-chip";
import { SectionHeading } from "../ui/section-heading";
import { catalogRoutePath } from "../route-paths";

/** Everything the activity touched that isn't already a headline: the parks
 * and forests it crossed, the destinations it set out for but the achievement
 * lines don't cover, and the routes it matched.
 *
 * Chips rather than rows, because these are navigation, not data — one flat
 * outlined pill each, the same shape area chips already use across the
 * detail pages. Reached destinations are deliberately absent: they have
 * their own achievement line above, and printing them twice would make the
 * page look like it had more in it than it does. */
export function SessionRelated({
  areas,
  goalDestinations,
  routes,
  className = "",
}: {
  areas: ProtectedArea[];
  goalDestinations: SessionDestination[];
  routes: SessionRoute[];
  className?: string;
}) {
  const named = goalDestinations.filter((destination) => destination.name);
  if (areas.length === 0 && named.length === 0 && routes.length === 0) return null;

  return (
    <section className={className} aria-labelledby="session-related">
      <SectionHeading>
        <span id="session-related">On this activity</span>
      </SectionHeading>

      <div className="mt-4 space-y-4">
        {areas.length > 0 ? (
          <ChipRow label="Protected areas">
            {sortAreasByProminence(areas).map((area) => (
              <AreaChip key={area.id} area={area} />
            ))}
          </ChipRow>
        ) : null}

        {named.length > 0 ? (
          <ChipRow label="Set out for">
            {named.map((destination) => (
              <LinkChip
                key={destination.id}
                href={`/destinations/${destination.id}`}
              >
                {destination.name}
              </LinkChip>
            ))}
          </ChipRow>
        ) : null}

        {routes.length > 0 ? (
          <ChipRow label={routes.length === 1 ? "Route" : "Routes"}>
            {routes.map((route) => (
              route.isCatalog ? (
                <LinkChip key={route.id} href={catalogRoutePath(route.id)}>
                  {route.name || "Unnamed route"}
                </LinkChip>
              ) : (
                <StaticChip key={route.id}>{route.name || "Unnamed route"}</StaticChip>
              )
            ))}
          </ChipRow>
        ) : null}
      </div>
    </section>
  );
}

/** A matched user route has no standalone catalog URL. Keep its name useful
 * without promising navigation to a page that cannot open. */
function StaticChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-[13px] font-medium text-ink-2">
      {children}
    </span>
  );
}

function ChipRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
      <span className="text-[12px] text-muted">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** A navigation chip: outlined, never filled, so a row of them doesn't spend
 * the accent budget on decoration (same reasoning as components/area-chip.tsx
 * and ui/chip.tsx). */
function LinkChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-2"
    >
      {children}
    </Link>
  );
}
