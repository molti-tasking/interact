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
  return (
    <section className="flex flex-col gap-4" aria-labelledby="problem-heading">
      <h2 id="problem-heading" className="text-2xl">
        The Problem
      </h2>
      <div className="overflow-hidden rounded-xl border">
        {/* Column headers (sm+) — on phones each row is labelled instead */}
        <div className="hidden grid-cols-2 sm:grid">
          <h3 className="bg-muted/30 px-5 py-3 text-sm font-semibold">
            Traditional Form Builders
          </h3>
          <h3 className="flex items-center gap-2 border-l border-primary/20 bg-primary/5 px-5 py-3 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Malleable Forms
          </h3>
        </div>
        <ul>
          {problemPairs.map((pair) => (
            <li
              key={pair.problem}
              className="grid border-t text-sm first:border-t-0 sm:grid-cols-2 sm:first:border-t"
            >
              <div className="bg-muted/30 px-5 py-3 text-muted-foreground">
                <span className="sr-only">Traditional form builders: </span>
                {pair.problem}
              </div>
              <div className="flex items-start gap-2 bg-primary/5 px-5 py-3 sm:border-l sm:border-primary/20">
                <ArrowRight
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:hidden"
                  aria-hidden
                />
                <span>
                  <span className="sr-only">Malleable Forms: </span>
                  {pair.solution}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <section className="flex flex-col gap-6" aria-labelledby="how-heading">
      <h2 id="how-heading" className="text-2xl">
        How It Works
      </h2>
      <p className="text-muted-foreground">
        You describe your intent in natural language. The system responds with{" "}
        <em>design probes</em>&mdash;targeted questions that surface tradeoffs
        and requirements you may not have considered. Each answer refines both
        the schema and the intent, converging on a form you could not have
        specified from scratch.
      </p>

      {/* Step selector: stacked on phones, a row from sm up */}
      <div className="flex flex-col gap-3 sm:flex-row" role="group" aria-label="Steps">
        {steps.map((step, i) => (
          <button
            key={step.number}
            type="button"
            onClick={() => setActiveStep(i)}
            aria-pressed={activeStep === i}
            aria-controls="how-it-works-detail"
            className={cn(
              "flex-1 flex items-center gap-3 rounded-xl border p-4 text-left transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
      <div
        id="how-it-works-detail"
        aria-live="polite"
        className="relative border rounded-2xl p-6 bg-muted/20 min-h-20 overflow-hidden"
      >
        {steps.map((step, i) => (
          <div
            key={step.number}
            aria-hidden={activeStep !== i}
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
      <div className="flex w-full flex-col gap-16 max-w-4xl py-4 sm:py-8">
        {/* Hero */}
        <section className="flex flex-col gap-6">
          <h1 className="text-4xl sm:text-5xl tracking-tight text-primary">
            Malleable Forms
          </h1>

          <p className="text-lg text-muted-foreground max-w-3xl leading-relaxed">
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
          <h2 className="text-2xl">
            Design Principles for Lazy Data Space Elicitation
          </h2>
          <p className="text-muted-foreground">
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
          <Button size={"lg"} asChild className="btn-brand">
            <Link href="/portfolios/new">
              Let&apos;s try it out
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
