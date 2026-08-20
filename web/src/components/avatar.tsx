interface AvatarProps {
  name: string | null;
  avatarUrl: string | null;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "w-8 h-8 text-xs",
  md: "w-12 h-12 text-sm",
  lg: "w-20 h-20 text-xl",
};

export default function Avatar({ name, avatarUrl, size = "md" }: AvatarProps) {
  const classes = sizeClasses[size];
  const initial = name ? name.charAt(0).toUpperCase() : "?";

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name || "User avatar"}
        className={`${classes} rounded-full object-cover shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${classes} flex shrink-0 items-center justify-center rounded-full bg-fill`}
    >
      <span className="font-medium text-ink-2">{initial}</span>
    </div>
  );
}
