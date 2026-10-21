"use client";

import {
  CapabilitiesProvider,
  type Capabilities,
} from "@/context/capabilities-context";
import { StaticUserProvider } from "@/context/user-context";
import type { MyStudyStateWithClock } from "@/hooks/query/study";
import {
  noopStudyLog,
  useStudyEventLogger,
  type StudyLog,
} from "@/hooks/query/study-events";
import { FINDING_THRESHOLDS } from "@/lib/engine/findings";
import type { MockUser } from "@/lib/mock-users";
import { createContext, useContext, useMemo, type ReactNode } from "react";

interface StudyContextValue {
  state: MyStudyStateWithClock;
  log: StudyLog;
}

const StudyContext = createContext<StudyContextValue | null>(null);

/**
 * Wraps a workshop participant's pages: logs their interactions, narrows
 * the shared workspace/responses components to what a participant may do,
 * and attributes provenance to "<name> (Participant)".
 */
export function StudyProvider({
  state,
  children,
}: {
  state: MyStudyStateWithClock;
  children: ReactNode;
}) {
  const { session, participant } = state;
  const log = useStudyEventLogger({
    sessionId: session.id,
    participantId: participant.id,
    phase: session.phase,
    portfolioId: participant.portfolio_id,
  });

  const { allowVoice, findingsMinResponses } = session.settings;
  const capabilities = useMemo<Capabilities>(
    () => ({
      publish: false,
      derive: false,
      voice: allowVoice,
      editResponses: false,
      recode: false,
      workspaceHref: () => `/study/${session.id}?tab=refine`,
      findingsThresholds: {
        ...FINDING_THRESHOLDS,
        minResponses: findingsMinResponses,
      },
    }),
    [allowVoice, findingsMinResponses, session.id],
  );

  const user = useMemo<MockUser>(
    () => ({
      id: participant.id,
      name: participant.display_name,
      role: "Participant",
    }),
    [participant.id, participant.display_name],
  );

  const value = useMemo(() => ({ state, log }), [state, log]);

  return (
    <StudyContext.Provider value={value}>
      <CapabilitiesProvider value={capabilities}>
        <StaticUserProvider user={user}>{children}</StaticUserProvider>
      </CapabilitiesProvider>
    </StudyContext.Provider>
  );
}

/** The participant's study state, or null outside study mode. */
export function useStudy(): StudyContextValue | null {
  return useContext(StudyContext);
}

/** Log a study interaction event; a no-op outside study mode. */
export function useStudyLog(): StudyLog {
  return useContext(StudyContext)?.log ?? noopStudyLog;
}
