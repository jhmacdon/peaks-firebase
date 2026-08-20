/** The 13px line under the H1: what this place is · where it is · what it
 * sits inside. Middle-dot separated, muted, one line where it fits.
 *
 * The first slot is an alert slot, held open and rendering nothing today.
 * AllTrails puts closures right here in the meta row as inline coloured
 * text rather than a banner (audit §4, "Alert"), and Peaks has no closure
 * data yet — when it arrives it belongs in this position, in `--alert`, not
 * in a new box bolted above the page.
 */
export function DestinationMetaRow({
  alert,
  parts,
}: {
  alert?: string | null;
  parts: Array<string | null>;
}) {
  const shown = parts.filter((part): part is string => !!part);
  if (!alert && shown.length === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[13px] tracking-[0.01em] text-muted">
      {alert ? (
        <>
          <span className="font-medium text-alert">{alert}</span>
          {shown.length > 0 ? <span aria-hidden>·</span> : null}
        </>
      ) : null}
      {shown.map((part, index) => (
        <span key={`${index}-${part}`} className="flex items-center gap-x-2">
          {part}
          {index < shown.length - 1 ? <span aria-hidden>·</span> : null}
        </span>
      ))}
    </p>
  );
}
