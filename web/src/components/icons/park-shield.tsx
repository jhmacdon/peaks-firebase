export function ParkShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M256 40 C250 64 150 84 96 100 C84 104 80 112 80 132 C80 300 120 400 256 476 C392 400 432 300 432 132 C432 112 428 104 416 100 C362 84 262 64 256 40 Z M256 152 L300 230 L278 230 L320 290 L296 290 L340 350 L278 350 L278 384 L234 384 L234 350 L172 350 L216 290 L192 290 L234 230 L212 230 Z"
      />
    </svg>
  );
}
