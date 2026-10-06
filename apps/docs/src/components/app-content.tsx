"use client";

import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";

/** A portfolio's workspace and its tabs (not `/portfolios/new`). */
const FULL_WIDTH_ROUTE = /^\/portfolios\/(?!new(?:\/|$))[^/]+/;

/**
 * Page content area of the app shell. Most pages are centered in a
 * container; portfolio workspaces (canvas, response tables) use the full
 * available width.
 */
export function AppContent({ children }: { children: React.ReactNode }) {
  const fullWidth = FULL_WIDTH_ROUTE.test(usePathname());
  return (
    <div
      className={cn(
        "mx-auto px-4 py-6 sm:px-6 sm:py-8",
        fullWidth ? "w-full" : "container",
      )}
    >
      {children}
    </div>
  );
}
