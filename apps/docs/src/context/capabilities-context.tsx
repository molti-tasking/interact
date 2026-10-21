"use client";

import { FINDING_THRESHOLDS } from "@/lib/engine/findings";
import { createContext, useContext, type ReactNode } from "react";

/**
 * What the shared workspace and responses components may offer. The admin
 * app uses the default (everything); study mode narrows it to what the
 * current workshop phase needs. Hiding is UX only — RLS and the portfolio
 * guard trigger (migration 011) enforce the rules.
 */
export interface Capabilities {
  /** Publish / unpublish the form */
  publish: boolean;
  /** Derive variants; lineage banner and links */
  derive: boolean;
  /** Voice input: dictation into the intent, "Talk" in the probe deck */
  voice: boolean;
  /** Open single responses for editing; AI column actions */
  editResponses: boolean;
  /** Recode response values from the dashboard and findings */
  recode: boolean;
  /** Where "open in Design" links point */
  workspaceHref: (portfolioId: string) => string;
  /** Finding thresholds (fewer responses in a workshop than in the field) */
  findingsThresholds: typeof FINDING_THRESHOLDS;
}

const FULL_CAPABILITIES: Capabilities = {
  publish: true,
  derive: true,
  voice: true,
  editResponses: true,
  recode: true,
  workspaceHref: (portfolioId) => `/portfolios/${portfolioId}`,
  findingsThresholds: FINDING_THRESHOLDS,
};

const CapabilitiesContext = createContext<Capabilities>(FULL_CAPABILITIES);

export function CapabilitiesProvider({
  value,
  children,
}: {
  value: Capabilities;
  children: ReactNode;
}) {
  return (
    <CapabilitiesContext.Provider value={value}>
      {children}
    </CapabilitiesContext.Provider>
  );
}

export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext);
}
