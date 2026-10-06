"use client";

import { useCurrentUser } from "@/context/user-context";
import {
  useDesignProbes,
  useReResolveDesignProbe,
  useRestoreProbeAnswer,
} from "@/hooks/query/design-probes";
import { useSpaceSiblings } from "@/hooks/query/portfolios";
import { useUndoToast } from "@/hooks/query/undo";
import { formatActor } from "@/lib/mock-users";
import type { Portfolio } from "@/lib/types";
import { useState } from "react";
import { toast } from "sonner";
import { DesignProbeResolvedDialog } from "./DesignProbeResolvedDialog";
import { ResolvedStack } from "./ResolvedStack";

/** Answered design probes: a stack that opens the full history, where answers can be changed. */
export function ResolvedSection({ portfolio }: { portfolio: Portfolio }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: designProbes } = useDesignProbes(portfolio.id);
  const reResolve = useReResolveDesignProbe(portfolio.id);
  const restoreAnswer = useRestoreProbeAnswer(portfolio.id);
  const spacePortfolios = useSpaceSiblings(portfolio);
  const notifyUndo = useUndoToast();
  const { currentUser } = useCurrentUser();

  if (!designProbes?.length) return null;

  // Resolved probes in chronological order (oldest first) for the history stack
  const resolvedProbes = [
    ...designProbes.filter((o) => o.status === "resolved"),
  ].reverse();

  const handleReResolve = async (probeId: string, newValue: string) => {
    const probe = resolvedProbes.find((p) => p.id === probeId);
    if (!probe) return;

    try {
      const result = await reResolve.mutateAsync({
        probe,
        newSelectedValue: newValue,
        // The saved state — never an unsaved intent draft
        snapshot: { intent: portfolio.intent, schema: portfolio.schema },
        editedBy: formatActor(currentUser),
        spacePortfolios,
      });
      notifyUndo(result.commit, `Changed answer to "${result.optionLabel}"`, {
        onUndone: () => restoreAnswer.mutateAsync(probe),
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to change the answer",
      );
    }
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
        onReResolve={handleReResolve}
        isReResolving={reResolve.isPending}
      />
    </>
  );
}
