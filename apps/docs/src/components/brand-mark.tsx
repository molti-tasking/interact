import { cn } from "@/lib/utils";

/**
 * Malleable Forms brand mark: one straight form field above one that bends.
 * Colours follow the theme: tile = primary, field = primary-foreground,
 * bending field = brand-warm. Keep in sync with src/app/icon.svg.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      className={cn("size-8 shrink-0", className)}
    >
      <rect width="64" height="64" rx="15" className="fill-primary" />
      <rect
        x="14"
        y="19"
        width="36"
        height="8"
        rx="4"
        className="fill-primary-foreground"
      />
      <path
        d="M18 41c4.7-5.5 9.3-5.5 14 0s9.3 5.5 14 0"
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        className="stroke-brand-warm"
      />
    </svg>
  );
}
