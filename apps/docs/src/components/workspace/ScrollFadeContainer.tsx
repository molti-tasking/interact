"use client";

import { useEffect, useRef, useState } from "react";

interface ScrollFadeContainerProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * A scrollable container that shows gradient fade overlays
 * at the top/bottom only when there is more content in that direction.
 */
export function ScrollFadeContainer({
  children,
  className,
}: ScrollFadeContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      setCanScrollUp(el.scrollTop > 0);
      setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };

    // Re-measure when the container or any of its items change size. The
    // observer also fires once right after `observe`, giving the initial state.
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    const observeAll = () => {
      if (!resizeObserver) return;
      resizeObserver.disconnect();
      resizeObserver.observe(el);
      for (const child of Array.from(el.children)) resizeObserver.observe(child);
    };
    observeAll();

    // Items added / removed → observe the new set.
    const mutationObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            observeAll();
            update();
          })
        : null;
    mutationObserver?.observe(el, { childList: true });

    el.addEventListener("scroll", update, { passive: true });
    if (!resizeObserver) update();

    return () => {
      el.removeEventListener("scroll", update);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className={
          className ?? "flex flex-col gap-2 overflow-y-auto max-h-[80vh] pr-1"
        }
      >
        {children}
      </div>
      {canScrollUp && (
        <div className="pointer-events-none absolute top-0 left-0 right-0 h-16 bg-linear-to-b from-background to-transparent z-10" />
      )}
      {canScrollDown && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-linear-to-t from-background to-transparent z-10" />
      )}
    </div>
  );
}
