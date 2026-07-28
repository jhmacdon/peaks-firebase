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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
          <AreaKindIcon area={area} className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold leading-tight text-gray-900 group-hover:text-teal-700 dark:text-white dark:group-hover:text-teal-300">
            {area.name}
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {[areaKindLabel(area.kind), location].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {facts.length > 0 && (
        <p className="mt-4 border-t border-gray-100 pt-3 text-xs font-medium text-gray-600 dark:border-gray-800 dark:text-gray-400">
          {facts.join(" · ")}
        </p>
      )}
    </Card>
  );
}

export default AreaCard;
