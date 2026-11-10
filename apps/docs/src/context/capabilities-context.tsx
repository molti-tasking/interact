"use client";

import { FINDING_THRESHOLDS } from "interact/forms/findings";
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
  /**
   * The design probe deck (probes, conflict checks). Off for study
   * participants in the "no-probes" ablation condition.
   */
  designProbes: boolean;
  /**
   * Let the creator turn on AI help for respondents ("What does this
   * mean?", "Fill from text"). Off for study participants: the peers
   * answering their forms must all get the same, plain form.
   */
  respondentAssist: boolean;
  /**
   * Pretest the form with simulated respondents. Off for study
   * participants: the workshop compares conditions on the tool as piloted,
   * and here the peers are the pretest.
   */
  pretest: boolean;
  /**
   * Look for themes in text answers (sends the answers to the model). Off
   * for study participants for the same reason.
   */
  answerThemes: boolean;
}

const FULL_CAPABILITIES: Capabilities = {
  publish: true,
  derive: true,
  voice: true,
  editResponses: true,
  recode: true,
  workspaceHref: (portfolioId) => `/portfolios/${portfolioId}`,
  findingsThresholds: FINDING_THRESHOLDS,
  designProbes: true,
  respondentAssist: true,
  pretest: true,
  answerThemes: true,
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
