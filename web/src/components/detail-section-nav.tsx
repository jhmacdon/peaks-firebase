export function DetailSectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  return (
    <nav aria-label="On this page" className="my-6 flex flex-wrap gap-x-5 gap-y-1 border-y border-hairline py-2">
      {sections.map(({ id, label }) => (
        <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-ink-2 underline-offset-4 hover:text-accent-text hover:underline">
          {label}
        </a>
      ))}
    </nav>
  );
}
