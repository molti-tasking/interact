"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Ideas for a first form: a title and a sentence in the creator's words. */
const EXAMPLES: { title: string; text: string }[] = [
  {
    title: "Birthday party",
    text: "I want to check which of my friends want to join my birthday.",
  },
  {
    title: "Europe travel trip",
    text: "When my parents visit me in Europe, I want to collect cool ideas and give them a nice trip.",
  },
  {
    title: "Bouldering crew",
    text: "I go bouldering every week and want to know when others train and which gyms they like.",
  },
  {
    title: "Book club",
    text: "Our book club needs to pick the next three books everyone actually wants to read.",
  },
  {
    title: "Board game night",
    text: "I host game nights and want to know which games people like and what snacks to get.",
  },
  {
    title: "Running group",
    text: "I'm starting a running group and need to know everyone's pace and preferred days.",
  },
  {
    title: "Plant swap",
    text: "I want to organise a plant swap: who brings what, and what they are looking for.",
  },
  {
    title: "Band rehearsal",
    text: "Our band needs to find a weekly rehearsal slot and collect song wishes for the next gig.",
  },
];

const ADVANCE_MS = 4500;

/**
 * A slowly sliding row of example forms to give people ideas. Pauses while
 * hovered or focused, and doesn't move on its own for reduced motion.
 */
export function ExampleCarousel() {
  const trackRef = useRef<HTMLUListElement>(null);
  const [paused, setPaused] = useState(false);

  const step = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector("li");
    const distance = (card?.getBoundingClientRect().width ?? 256) + 12;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    const atStart = track.scrollLeft <= 4;
    if (direction === 1 && atEnd) track.scrollTo({ left: 0, behavior: "smooth" });
    else if (direction === -1 && atStart)
      track.scrollTo({ left: track.scrollWidth, behavior: "smooth" });
    else track.scrollBy({ left: direction * distance, behavior: "smooth" });
  };

  useEffect(() => {
    if (paused) return;
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      // no matchMedia: animate
    }
    if (reduced) return;
    const timer = setInterval(() => step(1), ADVANCE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  return (
    <section
      aria-labelledby="examples-heading"
      className="space-y-3"
      data-testid="example-carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="examples-heading" className="flex items-center gap-1.5 text-sm font-medium">
          <Lightbulb className="h-4 w-4 text-muted-foreground" aria-hidden />
          Need an idea?
        </h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label="Previous examples" onClick={() => step(-1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label="More examples" onClick={() => step(1)}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
      <ul
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]"
      >
        {EXAMPLES.map((example) => (
          <li
            key={example.title}
            className="w-64 shrink-0 snap-start rounded-xl border bg-card p-4"
          >
            <p className="font-medium">{example.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{example.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
