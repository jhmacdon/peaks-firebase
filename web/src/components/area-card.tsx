import { areaKindLabel, type ProtectedArea } from "../lib/area-types";
import { AreaKindIcon } from "./area-kind-icon";
import { Card } from "./ui/card";

export interface AreaCardData extends ProtectedArea {
  state_codes?: string[];
  destination_count?: number;
  route_count?: number;
}

export function AreaCard({ area }: { area: AreaCardData }) {
  const location = area.state_codes?.join(", ");
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

  return (
    <Card href={`/areas/${encodeURIComponent(area.id)}`} className="h-full">
      <div className="flex items-start gap-3">
        {/* Neutral, not teal. The kind icon repeats on every card in the
            grid, and the accent budget (design-tokens.md law 4) does not
            stretch to a coloured tile per row. */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill text-ink-2">
          <AreaKindIcon area={area} className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-base font-medium leading-tight text-ink">
            {area.name}
          </span>
          <span className="mt-1 block text-sm text-muted">
            {[areaKindLabel(area.kind), location].filter(Boolean).join(" · ")}
          </span>
        </span>
      </div>

      {facts.length > 0 && (
        <p className="mt-3 text-sm text-muted">{facts.join(" · ")}</p>
      )}
    </Card>
  );
}

export default AreaCard;
