import ListCard from "../list-card";
import { EmptyState } from "../ui/empty-state";
import { DISCOVER_GRID, DiscoverSection, SectionLink } from "./discover-section";
import type { ListRow } from "../../lib/actions/lists";

export function DiscoverLists({ lists }: { lists: ListRow[] }) {
  return (
    <DiscoverSection
      id="browse-lists"
      title="Browse lists"
      description="Curated collections for peak-bagging, planning, and progress."
      action={<SectionLink href="/lists">All lists</SectionLink>}
    >
      {lists.length === 0 ? (
        <EmptyState>No lists available</EmptyState>
      ) : (
        <div className={DISCOVER_GRID}>
          {lists.map((list) => (
            <ListCard key={list.id} list={list} />
          ))}
        </div>
      )}
    </DiscoverSection>
  );
}
