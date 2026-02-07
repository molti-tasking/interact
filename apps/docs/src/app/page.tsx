"use client";

import { FileText, Sparkles, Users } from "lucide-react";

export default function Home() {
  return (
    <div className="flex items-center justify-center">
      <main className="flex w-full flex-col gap-12">
        {/* Hero Section */}
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="text-4xl font-bold tracking-tight">Interact</h1>
          <p className="text-xl text-muted-foreground max-w-3xl">
            An open source library for building reusable, interactive UI
            components that thoughtfully integrate generative AI into web forms.
            Going beyond chat interfaces to support sophisticated, AI-agnostic
            systems.
          </p>
        </div>

        {/* Overview */}
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Philosophy</h2>
          <p>
            The landscape of generative AI components is dominated by chat
            interfaces and agentic workflows. Yet sophisticated systems have
            operated our world long before generative AI emerged. We believe
            good systems should not depend on generative AI—they should work
            perfectly well without it.
          </p>
          <p>
            <strong>Interact</strong> empowers system builders to implement{" "}
            <em>thoughtful, opinionated</em> AI interactions into AI-agnostic
            systems. Our components enhance existing workflows rather than
            replace them, maintaining system reliability while unlocking new
            capabilities.
          </p>
        </div>

        {/* Motivation & Research Context */}
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">
            Motivation & Research Value
          </h2>

          <div className="bg-muted p-6 rounded-lg space-y-3">
            <div className="flex items-start gap-3">
              <Users className="h-5 w-5 mt-1 text-primary shrink-0" />
              <div>
                <h3 className="font-semibold mb-2">
                  The Standardization Problem
                </h3>
                <p className="text-sm">
                  Organizations often struggle with form standardization across
                  departments. High-paid intermediary managers spend months
                  understanding diverse needs across teams to create
                  &quot;one-size-fits-all&quot; solutions. The result?
                  Compromised forms that leave everyone slightly dissatisfied,
                  deployed after lengthy delays.
                </p>
              </div>
            </div>
          </div>

          <p>
            This challenge represents a fundamental tension in software systems:
            the need for structure versus flexibility, standardization versus
            customization. Current approaches to AI-form interaction focus
            primarily on auto-completion and generation, missing opportunities
            for collaborative adaptation and user empowerment.
          </p>

          <p>
            <strong>Research Gap:</strong> There is limited investigation into
            how generative AI can support <em>dynamic form evolution</em> while
            maintaining data integrity, validation consistency, and user
            control. How do we balance AI-suggested structural changes with
            governance requirements? How do timing and interaction patterns
            affect user trust and responsibility?
          </p>
        </div>

        {/* Malleable Forms Concept */}
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Malleable Forms</h2>

          <div className="bg-primary/5 border-l-4 border-primary p-6 rounded-r-lg space-y-3">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 mt-1 text-primary shrink-0" />
              <div>
                <h3 className="font-semibold mb-2">Core Concept</h3>
                <p className="text-sm">
                  <strong>Malleable forms</strong> are web forms that can adapt
                  their structure dynamically based on user needs and AI
                  suggestions, while preserving data integrity and validation
                  rules. Users can request schema modifications through natural
                  language, and the system manages version control, data
                  migration, and validation.
                </p>
              </div>
            </div>
          </div>

          <p>
            Unlike traditional static forms or purely AI-generated forms,
            malleable forms maintain explicit schemas, support incremental
            modification, and provide transparent change management. The form
            creator can define what types of changes are permissible, balancing
            flexibility with governance.
          </p>

          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div className="border rounded-lg p-4 space-y-2">
              <h3 className="font-semibold text-sm">Traditional Forms</h3>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Fixed structure</li>
                <li>• Developer-only modifications</li>
                <li>• Version updates break data</li>
              </ul>
            </div>
            <div className="border rounded-lg p-4 space-y-2 bg-primary/5">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Malleable Forms
              </h3>
              <ul className="text-sm space-y-1">
                <li>• Dynamic structure</li>
                <li>• User-requested changes</li>
                <li>• Managed migrations</li>
                <li>• Validation preservation</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Design Principles */}
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Design Principles</h2>

          <p>
            Responsible integration of generative AI into form systems requires
            careful consideration of interaction patterns, timing, and user
            control. Our components are designed around key principles informed
            by HCI research:
          </p>

          <div className="space-y-4 mt-2">
            <div className="border-l-2 pl-4 py-1">
              <h3 className="font-semibold text-sm mb-1">
                User Attention & Responsibility
              </h3>
              <p className="text-sm text-muted-foreground">
                Scientific research demonstrates that the timing of UI
                interactions significantly affects user attention and sense of
                responsibility. Artificial delays in AI automations can improve
                performance by maintaining user engagement and oversight.
              </p>
            </div>

            <div className="border-l-2 pl-4 py-1">
              <h3 className="font-semibold text-sm mb-1">AI-Agnostic Design</h3>
              <p className="text-sm text-muted-foreground">
                Systems must function fully without AI. Generative features
                enhance workflows but never become critical dependencies.
              </p>
            </div>

            <div className="border-l-2 pl-4 py-1">
              <h3 className="font-semibold text-sm mb-1">
                Transparent Change Management
              </h3>
              <p className="text-sm text-muted-foreground">
                Schema modifications, data migrations, and validation changes
                are explicit and traceable. Users understand what changed and
                why.
              </p>
            </div>

            <div className="border-l-2 pl-4 py-1">
              <h3 className="font-semibold text-sm mb-1">
                Opinionated Interactions
              </h3>
              <p className="text-sm text-muted-foreground">
                Rather than generic AI capabilities, we provide specific,
                well-designed interaction patterns for common form scenarios.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
