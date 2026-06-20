export function SectionHeading({
  title,
  action,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${className}`.trim()}>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h2>
      {action}
    </div>
  );
}
