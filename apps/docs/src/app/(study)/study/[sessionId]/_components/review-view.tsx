"use client";

import { ResponsesDashboard } from "@/app/(app)/responses/[portfolioId]/_components/dashboard/responses-dashboard";
import { ResponsesDataTable } from "@/app/(app)/responses/[portfolioId]/_components/responses-data-table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStudy } from "@/context/study-context";
import { useResponses } from "@/hooks/query/responses-new";
import type { Portfolio } from "@/lib/types";
import { BarChart3, Loader2, MessageSquareText, PencilRuler, Table2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DesignView } from "./create-view";
import { useCoachTour } from "./use-coach-tour";

type ReviewTab = "answers" | "refine";
type AnswersView = "dashboard" | "table";

/** The tab lives in the URL (`?tab=refine`) — "Send to Design" links there. */
function useReviewTab(): [ReviewTab, (tab: ReviewTab) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: ReviewTab = searchParams.get("tab") === "refine" ? "refine" : "answers";
  const setTab = (next: ReviewTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "answers") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return [tab, setTab];
}

/**
 * Review the answers to the own form — is their structure useful? — and
 * refine the form in the workspace.
 */
export function ReviewView({
  portfolio,
  replayTour,
}: {
  portfolio: Portfolio;
  replayTour: number;
}) {
  const { state, log } = useStudy()!;
  const [tab, setTab] = useReviewTab();
  const [view, setView] = useState<AnswersView>("dashboard");
  // Late answers (grace window) still arrive at the start of the phase
  const responses = useResponses(portfolio.id, { refetchInterval: 10_000 });

  useCoachTour({
    tour: "review",
    participantId: state.participant.id,
    ready: tab === "answers" && responses.isSuccess,
    replay: replayTour,
  });

  const count = responses.data?.length ?? 0;

  return (
    <div className="space-y-5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onValueChange={(next) => {
            log("review_tab", { tab: next });
            setTab(next as ReviewTab);
          }}
        >
          <TabsList aria-label="Review" data-tour="review-tabs">
            <TabsTrigger value="answers" data-testid="review-tab-answers">
              <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
              Answers{responses.isSuccess ? ` (${count})` : ""}
            </TabsTrigger>
            <TabsTrigger value="refine" data-testid="review-tab-refine">
              <PencilRuler className="h-3.5 w-3.5" aria-hidden />
              Refine
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "answers" && (
          <Tabs
            value={view}
            onValueChange={(next) => {
              log("answers_view", { view: next });
              setView(next as AnswersView);
            }}
          >
            <TabsList aria-label="Answers view">
              <TabsTrigger value="dashboard">
                <BarChart3 className="h-3.5 w-3.5" aria-hidden />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="table">
                <Table2 className="h-3.5 w-3.5" aria-hidden />
                Table
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {tab === "refine" ? (
        <DesignView portfolio={portfolio} />
      ) : responses.isPending ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      ) : responses.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load the answers: {responses.error.message}
        </p>
      ) : view === "dashboard" ? (
        <ResponsesDashboard
          portfolio={portfolio}
          responses={responses.data}
          refetchRows={async () => (await responses.refetch()).data ?? []}
        />
      ) : (
        <ResponsesDataTable portfolio={portfolio} responses={responses.data} />
      )}
    </div>
  );
}
