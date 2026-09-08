import { Button } from "./ui/button";

export function CatalogPagination({ page, pageCount, href }: { page: number; pageCount: number; href: (page: number) => string }) {
  if (pageCount <= 1) return null;
  return <nav aria-label="Results pages" className="mt-8 flex flex-wrap items-center justify-between gap-3">
    {page > 1 ? <Button variant="secondary" href={href(page - 1)}>← Previous</Button> : <span />}
    <span className="text-sm text-muted">Page {page.toLocaleString("en-US")} of {pageCount.toLocaleString("en-US")}</span>
    {page < pageCount ? <Button variant="secondary" href={href(page + 1)}>Next →</Button> : <span />}
  </nav>;
}
