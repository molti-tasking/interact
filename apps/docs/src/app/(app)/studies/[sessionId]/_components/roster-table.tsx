"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePortfolio } from "@/hooks/query/portfolios";
import { useReassignSeat, type RosterEntry } from "@/hooks/query/study";
import { useNow } from "@/hooks/use-now";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import { formatRelativeTime } from "@/lib/provenance-format";
import type { StudyPhase } from "@/lib/study/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, Eye, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** Seen within this window counts as online (heartbeat: 30 s). */
const ONLINE_MS = 75_000;

export function RosterTable({
  sessionId,
  phase,
  roster,
}: {
  sessionId: string;
  phase: StudyPhase;
  roster: RosterEntry[];
}) {
  const now = useNow(5_000);
  const reassign = useReassignSeat();
  const [monitorId, setMonitorId] = useState<string | null>(null);
  const peers = Math.max(0, roster.length - 1);

  if (roster.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nobody has joined yet. Share the join code.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Form</TableHead>
              <TableHead className="text-right">Questions</TableHead>
              <TableHead className="text-right">Probes answered</TableHead>
              <TableHead className="text-right">Answered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead>Questionnaire</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roster.map((entry) => {
              const online = now - new Date(entry.lastSeenAt).getTime() < ONLINE_MS;
              const rejoinOpen =
                !!entry.rejoinUntil && new Date(entry.rejoinUntil).getTime() > now;
              return (
                <TableRow key={entry.participantId}>
                  <TableCell className="font-medium">{entry.displayName}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        aria-hidden
                        className={cn(
                          "h-2 w-2 rounded-full",
                          online ? "bg-emerald-500" : "bg-muted-foreground/30",
                        )}
                      />
                      {formatRelativeTime(entry.lastSeenAt, now)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-56 truncate" title={entry.title ?? undefined}>
                    {entry.title}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{entry.fieldCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{entry.probesResolved}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      phase === "answer" && entry.responsesGiven >= peers && "text-emerald-600",
                    )}
                  >
                    {entry.responsesGiven}/{peers}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {entry.responsesReceived}
                  </TableCell>
                  <TableCell>
                    {entry.questionnaireDone && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Submitted" />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!entry.portfolioId}
                        onClick={() => setMonitorId(entry.portfolioId)}
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden />
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={reassign.isPending || rejoinOpen}
                        title="Let this person join again from another browser (10 minutes)"
                        onClick={() =>
                          reassign.mutate(
                            { sessionId, participantId: entry.participantId },
                            {
                              onSuccess: () =>
                                toast.success(
                                  `${entry.displayName} can rejoin with the same name for 10 minutes`,
                                ),
                              onError: (err) => toast.error(err.message),
                            },
                          )
                        }
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        {rejoinOpen ? "Rejoin open" : "Reassign"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <FormMonitorDialog portfolioId={monitorId} onClose={() => setMonitorId(null)} />
    </>
  );
}

/**
 * Read-only look at a participant's form. Deliberately not the workspace:
 * mounting it would curate probes and precompute previews on the
 * participant's form, attributed to the facilitator.
 */
function FormMonitorDialog({
  portfolioId,
  onClose,
}: {
  portfolioId: string | null;
  onClose: () => void;
}) {
  const portfolio = usePortfolio(portfolioId ?? undefined);
  const data = portfolio.data;

  return (
    <Dialog open={portfolioId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{data?.title ?? "Form"}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">
            {data?.intent.purpose.content || "No intent yet."}
          </DialogDescription>
        </DialogHeader>
        {portfolio.isLoading ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : data && data.schema.fields.length > 0 ? (
          <FormRenderer schema={data.schema} mode="preview" />
        ) : (
          <p className="text-sm text-muted-foreground">No questions yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
