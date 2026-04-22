import {
  parseExternalRouteLinks,
  type ParsedExternalRouteLink,
} from "../lib/route-guide";

interface RouteExternalLinksProps {
  links: unknown[] | null | undefined;
}

function ExternalLinkItem({ link }: { link: ParsedExternalRouteLink }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-blue-300 hover:bg-blue-50/30 dark:border-gray-800 dark:bg-gray-950/40 dark:hover:border-blue-700 dark:hover:bg-blue-950/20"
    >
      <div>
        <div className="text-sm font-medium">{link.label}</div>
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {link.display}
        </div>
      </div>
      <span className="text-xs font-medium text-blue-600 transition-transform group-hover:translate-x-0.5 dark:text-blue-400">
        Open
      </span>
    </a>
  );
}

export default function RouteExternalLinks({ links }: RouteExternalLinksProps) {
  const parsed = parseExternalRouteLinks(links);

  if (parsed.length === 0) {
    return <p className="text-sm text-gray-500">No external resources linked</p>;
  }

  return (
    <div className="space-y-3">
      {parsed.map((link) => (
        <ExternalLinkItem key={`${link.type}:${link.id}`} link={link} />
      ))}
    </div>
  );
}
