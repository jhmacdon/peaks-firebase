export function PageHeader({
  title,
  meta,
  actions,
  className = "",
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`flex flex-wrap items-start justify-between gap-x-6 gap-y-3 ${className}`.trim()}
    >
      <div className="min-w-0">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
          {title}
        </h1>
        {meta && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{meta}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}
