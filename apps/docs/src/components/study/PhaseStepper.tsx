import { PHASE_COPY, STUDY_PHASES, type StudyPhase } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/** The working phases (lobby and done are states around them). */
const STEPS = STUDY_PHASES.filter((p) => p !== "lobby" && p !== "done");

export function PhaseStepper({
  phase,
  size = "sm",
  className,
}: {
  phase: StudyPhase;
  size?: "sm" | "lg";
  className?: string;
}) {
  const current = STUDY_PHASES.indexOf(phase);
  return (
    <ol
      aria-label="Workshop phases"
      className={cn(
        "flex items-center",
        size === "lg" ? "gap-4 text-2xl" : "gap-1.5 text-xs",
        className,
      )}
    >
      {STEPS.map((step, i) => {
        const index = STUDY_PHASES.indexOf(step);
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex items-center gap-1.5">
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "h-px bg-border",
                  size === "lg" ? "w-10" : "w-3",
                )}
              />
            )}
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border",
                size === "lg" ? "px-5 py-2" : "px-2 py-0.5",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-transparent text-muted-foreground",
                !active && !done && "text-muted-foreground",
              )}
            >
              {done && (
                <Check
                  className={size === "lg" ? "h-6 w-6" : "h-3 w-3"}
                  aria-hidden
                />
              )}
              {PHASE_COPY[step].label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
