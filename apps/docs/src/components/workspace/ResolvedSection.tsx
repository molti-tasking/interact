"use client";

import { useCurrentUser } from "@/context/user-context";
import { useStudyLog } from "@/context/study-context";
import { useAskProbeAgain, useDesignProbes } from "@/hooks/query/design-probes";
import { formatActor } from "@/lib/mock-users";
import type { Portfolio } from "@/lib/types";
import { useState } from "react";
import { toast } from "sonner";
import { useDeckFocus } from "./deck-canvas-context";
import { DesignProbeResolvedDialog } from "./DesignProbeResolvedDialog";
import { ResolvedStack } from "./ResolvedStack";

/**
 * Answered elicitation questions: a stack that opens the full history. An
 * answer is changed by asking the question again — it returns to the open
 * questions, where the new answer is previewed before it is applied.
 */
export function ResolvedSection({ portfolio }: { portfolio: Portfolio }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: designProbes } = useDesignProbes(portfolio.id);
  const askAgain = useAskProbeAgain(portfolio.id);
  const [, setFocusedId] = useDeckFocus();
  const { currentUser } = useCurrentUser();
  const log = useStudyLog();

  if (!designProbes?.length) return null;

  // Chronological order (oldest first) for the history stack
  const resolvedProbes = [
    ...designProbes.filter((o) => o.status === "resolved"),
  ].reverse();

  const handleReopen = (probeId: string) => {
    const probe = resolvedProbes.find((p) => p.id === probeId);
    if (!probe) return;
    log("probe_reopened", { id: probe.id, text: probe.text, previous: probe.selectedOption });
    askAgain.mutate(
      { probe, askedBy: formatActor(currentUser) },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setFocusedId(probe.id);
          toast("Question reopened", {
            description:
              "The form stays as it is until you choose an answer. Each answer shows what it would change.",
          });
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Couldn't reopen the question"),
      },
    );
  };

  return (
    <>
      <ResolvedStack
        resolvedProbes={resolvedProbes}
        onViewAll={() => setDialogOpen(true)}
      />
      <DesignProbeResolvedDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        resolvedProbes={resolvedProbes}
        onReopen={handleReopen}
        isReopening={askAgain.isPending}
      />
    </>
  );
}
