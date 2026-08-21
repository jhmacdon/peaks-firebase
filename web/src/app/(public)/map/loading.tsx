export default function Loading() {
  return (
    // Same height arithmetic as the map itself — see --chrome-* in
    // globals.css — so the skeleton doesn't resize the moment the map lands.
    <div className="flex h-[calc(100dvh-var(--chrome-top-h)-var(--chrome-bottom-h))] items-center justify-center bg-gray-100 md:h-[calc(100dvh-var(--chrome-h))] dark:bg-gray-900">
      <span className="text-muted">Loading map…</span>
    </div>
  );
}
