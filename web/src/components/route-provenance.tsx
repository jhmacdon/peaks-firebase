import type { RouteProvenance } from "../lib/route-provenance";

interface RouteProvenanceProps {
  provenance: RouteProvenance | null;
}

function sourceLabel(sourceKind: string): string {
  return sourceKind
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function RouteProvenanceNotice({ provenance }: RouteProvenanceProps) {
  if (!provenance) return null;

  const retrievedAt = new Date(provenance.retrieved_at);
  const retrievedLabel = Number.isNaN(retrievedAt.getTime())
    ? null
    : retrievedAt.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
      <span>Route geometry source: </span>
      <a
        href={provenance.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-700 hover:underline dark:text-blue-300"
      >
        {sourceLabel(provenance.source_kind)}
      </a>
      <span> · </span>
      <span>{provenance.attribution}</span>
      <span> · </span>
      <a
        href={provenance.license_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-700 hover:underline dark:text-blue-300"
      >
        {provenance.license_name}
      </a>
      {provenance.contains_osm_geometry && (
        <>
          {provenance.osm_way_urls.length > 0 && (
            <>
              <span> · </span>
              <a
                href={provenance.osm_way_urls[0]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 hover:underline dark:text-blue-300"
              >
                {provenance.osm_way_urls.length === 1
                  ? "View source way"
                  : "View a source way"}
              </a>
            </>
          )}
        </>
      )}
      {retrievedLabel && <span> · Retrieved {retrievedLabel}</span>}
    </div>
  );
}
