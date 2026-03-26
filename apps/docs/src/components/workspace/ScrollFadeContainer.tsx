"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ScrollFadeContainerProps {
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * A scrollable container that shows gradient fade overlays
 * at the top/bottom only when there is more content in that direction.
 */
export function ScrollFadeContainer({
  children,
  className,
  ...props
}: ScrollFadeContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 0);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);

  useEffect(() => {
    requestAnimationFrame(updateScrollState);
  });

  return (
    <div className="relative" {...props}>
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className={
          className ??
          "flex flex-col gap-3 overflow-y-auto max-h-[80vh] pr-1 py-2"
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
