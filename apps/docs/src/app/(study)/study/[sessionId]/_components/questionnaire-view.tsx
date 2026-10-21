"use client";

import { Card } from "@/components/ui/card";
import { useStudy } from "@/context/study-context";
import { useMyQuestionnaire, useSubmitQuestionnaire } from "@/hooks/query/study";
import { FormRenderer } from "@/lib/form-renderer/FormRenderer";
import { FINAL_INSTRUMENT, FINAL_QUESTIONNAIRE } from "@/lib/study/instruments";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** The final questionnaire (SUS, CDN items, reflection) — once per participant. */
export function QuestionnaireView() {
  const { state, log } = useStudy()!;
  const { session, participant } = state;
  const existing = useMyQuestionnaire(participant.id, FINAL_INSTRUMENT);
  const submit = useSubmitQuestionnaire();
  const openedAt = useRef(0);

  const submitted = !!existing.data;
  useEffect(() => {
    if (!existing.isSuccess || submitted) return;
    openedAt.current = Date.now();
    log("questionnaire_opened", { instrument: FINAL_INSTRUMENT });
  }, [existing.isSuccess, submitted, log]);

  if (existing.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-xl space-y-3 py-16 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <h1 className="text-2xl tracking-tight">Thanks — your answers are saved.</h1>
        <p className="text-muted-foreground">
          Wait for the facilitator to close the workshop.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <div className="space-y-1">
        <h1 className="text-2xl tracking-tight">How did it go?</h1>
        <p className="text-muted-foreground">
          A few questions about the tool and your experience today. There are
          no right or wrong answers.
        </p>
      </div>
      <Card className="p-6 md:p-8">
        <FormRenderer
          schema={FINAL_QUESTIONNAIRE}
          mode="live"
          randomFill={false}
          onSubmit={async (answers) => {
            try {
              await submit.mutateAsync({
                sessionId: session.id,
                participantId: participant.id,
                instrument: FINAL_INSTRUMENT,
                answers,
              });
              log("questionnaire_submitted", {
                instrument: FINAL_INSTRUMENT,
                ms: Date.now() - openedAt.current,
              });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't save your answers");
              throw err;
            }
          }}
        />
      </Card>
    </div>
  );
}
