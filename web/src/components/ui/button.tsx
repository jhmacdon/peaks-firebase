import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { isExternalHref } from "../../lib/url-utils";

// Button — see web/docs/design-tokens.md ("Accent budget", "Radius", law 6).
//
// primary is the one filled/accent action a surface gets (law 4). Its label
// is pinned to the light-ink hex, not the `text-ink` token — `--color-ink`
// inverts to near-white in dark mode, which would fail contrast against the
// accent fill (doc: "Primary buttons: accent fill + ink text, not white").
// secondary/quiet/danger stay on neutral fills or outlines. Hover never
// lifts/scales/grows a shadow (law 6) — it only darkens the fill, via the
// color-mix rules in globals.css (.btn-primary/.btn-secondary/.btn-quiet/
// .btn-danger).
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "md" | "sm";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "btn-primary bg-accent text-[#21211F]",
  secondary: "btn-secondary border border-border bg-page text-ink",
  quiet: "btn-quiet bg-transparent text-accent-text",
  danger: "btn-danger border border-alert bg-transparent text-alert",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "h-10 px-4 text-sm",
  sm: "h-8 px-3 text-[13px]",
};

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-ctl font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";

function buttonClassName(variant: ButtonVariant, size: ButtonSize, className: string): string {
  return `${BASE} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`.trim();
}

type OwnProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

type ButtonAsButton = OwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
  };

type ButtonAsLink = OwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href"> & {
    href: string;
    /** Force internal (`<Link>`) or external (`<a target="_blank">`)
     * handling instead of guessing from the URL scheme. */
    external?: boolean;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function LinkButton({
  variant = "primary",
  size = "md",
  className = "",
  children,
  href,
  external,
  ...rest
}: ButtonAsLink) {
  const cls = buttonClassName(variant, size, className);
  const goesExternal = external ?? isExternalHref(href);

  if (goesExternal) {
    return (
      <a href={href} className={cls} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}

function PlainButton({
  variant = "primary",
  size = "md",
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonAsButton) {
  const cls = buttonClassName(variant, size, className);
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    return <LinkButton {...props} />;
  }
  return <PlainButton {...props} />;
}
