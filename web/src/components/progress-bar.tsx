interface ProgressBarProps {
  completed: number;
  total: number;
  className?: string;
}

export default function ProgressBar({ completed, total, className = "" }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="font-mono-num tabular-nums text-ink-2">
          {completed} / {total}
        </span>
        <span className="font-mono-num tabular-nums font-medium text-ink">{pct}%</span>
      </div>
      <div className="h-2 bg-fill rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
