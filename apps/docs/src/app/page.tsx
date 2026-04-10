"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  GitBranch,
  ListChecks,
  MessageSquare,
  ScrollText,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const problemPairs = [
  {
    problem: "Require the full data space upfront",
    solution: "Schema emerges through conversation",
  },
  {
    problem: "Assume data modeling skill",
    solution: "Meets you where you are",
  },
  {
    problem: "No guidance for domain-specific decisions",
    solution: "Surfaces considerations you hadn\u2019t thought of",
  },
];

const steps = [
  {
    number: 1,
    title: "Express your intent",
    short: "Start with a sentence",
    detail:
      "\u201cI need a registration form for our youth soccer club\u2019s new season\u201d",
  },
  {
    number: 2,
    title: "Resolve design probes",
    short: "Answer targeted questions",
    detail:
      "What age groups? Collect medical info? How is payment handled? Each answer shapes the schema.",
  },
  {
    number: 3,
    title: "Evolve through use",
    short: "Adapt over time",
    detail:
      "New requirements emerge? Another collaborator takes over? The intent portfolio keeps everything aligned.",
  },
];

function ProblemSection() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">The Problem</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="border rounded-xl p-5 space-y-3 bg-muted/30">
          <h3 className="font-semibold text-sm">Traditional Form Builders</h3>
          <ul className="text-sm space-y-2 text-muted-foreground">
            {problemPairs.map((pair, i) => (
              <li
                key={i}
                className={cn(
                  "cursor-default rounded-md px-2 py-1 -mx-2 transition-colors duration-200",
                  hoveredIndex === i && "bg-destructive/10 text-destructive",
                )}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {pair.problem}
              </li>
            ))}
          </ul>
        </div>
        <div className="border rounded-xl p-5 space-y-3 bg-primary/5 border-primary/20">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Malleable Forms
          </h3>
          <ul className="text-sm space-y-2">
            {problemPairs.map((pair, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-md px-2 py-1 -mx-2 transition-all duration-200",
                  hoveredIndex === i
                    ? "bg-primary/15 text-primary font-medium scale-[1.02]"
                    : hoveredIndex !== null
                      ? "text-muted-foreground/50"
                      : "",
                )}
              >
                {pair.solution}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const [activeStep, setActiveStep] = useState<number | null>(null);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-2xl font-semibold">How It Works</h2>
      <p className="text-muted-foreground font-sans">
        You describe your intent in natural language. The system responds with{" "}
        <em>design probes</em>&mdash;targeted questions that surface tradeoffs
        and requirements you may not have considered. Each answer refines both
        the schema and the intent, converging on a form you could not have
        specified from scratch.
      </p>

      {/* Horizontal step selector */}
      <div className="flex gap-3">
        {steps.map((step, i) => (
          <button
            key={step.number}
            onClick={() => setActiveStep(i)}
            className={cn(
              "flex-1 flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-200 cursor-pointer",
              activeStep === i
                ? "border-primary/40 bg-primary/5 shadow-sm"
                : "border-transparent bg-muted/30 hover:bg-muted/50",
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center h-8 w-8 rounded-full text-sm font-semibold shrink-0 transition-colors duration-200",
                activeStep === i
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {step.number}
            </div>
            <div>
              <p
                className={cn(
                  "font-semibold text-sm transition-colors duration-200",
                  activeStep === i ? "text-primary" : "",
                )}
              >
                {step.title}
              </p>
              <p className="text-xs text-muted-foreground">{step.short}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Detail panel */}
      <div className="relative border rounded-2xl p-6 bg-muted/20 min-h-[80px] overflow-hidden">
        {steps.map((step, i) => (
          <div
            key={step.number}
            className={cn(
              "transition-all duration-300 ease-out",
              activeStep === i
                ? "opacity-100 translate-y-0"
                : "opacity-0 absolute inset-6 translate-y-2 pointer-events-none",
            )}
          >
            <p className="text-xl text-muted-foreground italic">
              {step.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div className="flex items-center justify-center">
      <main className="flex w-full flex-col gap-16 max-w-4xl py-8">
        {/* Hero */}
        <section className="flex flex-col gap-6">
          <h1
            className="text-5xl tracking-tight text-primary"
            style={{ fontFamily: "var(--font-delius), cursive" }}
          >
            Malleable Forms
          </h1>

          <p className="text-lg text-muted-foreground font-sans max-w-3xl leading-relaxed">
            Malleable Forms replaces upfront specification with{" "}
            <em>lazy data space elicitation</em>: you start with a sentence
            describing what you need, and the system helps you discover and
            refine your data schema through a structured conversational process.
          </p>
        </section>

        {/* Problem */}
        <ProblemSection />

        {/* How It Works */}
        <HowItWorksSection />

        {/* Design Principles — based on Section 3 */}
        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold">
            Design Principles for Lazy Data Space Elicitation
          </h2>
          <p className="text-muted-foreground font-sans">
            Instead of front-loaded specification, the data space is{" "}
            <em>elicited lazily</em>: the creator begins with a rough intent and
            progressively refines the underlying schema through a structured
            conversational process. Four design principles govern this process.
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            {/* P1: Iterative Convergence */}
            <div className="border rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-blue-50 text-blue-600">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-sm">Iterative Convergence</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The data space emerges through successive refinement. Design
                probes act as cognitive forcing functions: each requires an
                active evaluative choice that channels domain knowledge into the
                specification. A novice triggers more follow-up questions; an
                expert skips intermediate rounds.
              </p>
            </div>

            {/* P2: Intent-Schema Co-Persistence */}
            <div className="border rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-violet-50 text-violet-600">
                  <ListChecks className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-sm">
                  Intent&ndash;Schema Co-Persistence
                </h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The natural-language intent and structured schema are stored
                together as a single linked artifact&mdash;the{" "}
                <em>intent portfolio</em>. Domain context travels with the
                schema, so anyone can reopen the portfolio and understand not
                just <em>what</em> it contains but{" "}
                <em>what it was intended to capture</em>.
              </p>
            </div>

            {/* P3: Decision Traceability */}
            <div className="border rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-amber-50 text-amber-600">
                  <ScrollText className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-sm">Decision Traceability</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                An append-only provenance log records each change together with
                its rationale. When a new collaborator encounters an unfamiliar
                field, the log explains why it was added&mdash;without requiring
                human mediation.
              </p>
            </div>

            {/* P4: Scenario-Driven Derivation */}
            <div className="border rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-green-50 text-green-600">
                  <GitBranch className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-sm">
                  Scenario-Driven Derivation
                </h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                New portfolio instances are derived from a shared base schema
                for specific scenarios. A derivation can be a{" "}
                <em>sub-schema</em> (subset of fields), a <em>super-schema</em>{" "}
                (extensions), or a <em>mixed case</em> combining
                both&mdash;without duplicating the data space.
              </p>
            </div>
          </div>
        </section>

        <section className="flex flex-row-reverse">
          <Link href="/portfolios/new">
            <Button size={"lg"}>
              Let&apos;s try it out
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </section>
      </main>
    </div>
  );
}
