"use client";

import { briefImageUrl } from "@/lib/study/briefs";

/**
 * The situation of a brief. An image on purpose (see the route): it can be
 * read but not pasted into the tool.
 */
export function BriefImage({ briefKey }: { briefKey: string }) {
  return (
    // A plain <img>: the route renders the PNG itself, nothing to optimise
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={briefImageUrl(briefKey)}
      alt="The situation for this task. It is shown as a picture, so please read it on screen."
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
      className="w-full select-none rounded-xl border bg-[#fffdf8]"
      data-testid="brief-image"
    />
  );
}
