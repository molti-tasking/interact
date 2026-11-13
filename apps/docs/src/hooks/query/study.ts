"use client";

/**
 * Study mode (workshop sessions, migration 011).
 *
 * Participants are anonymous Supabase users; they reach their session via
 * SECURITY DEFINER functions (`join_study_session`, `get_my_study_state`,
 * `get_study_forms`) and their own rows via RLS. Facilitator hooks need an
 * app admin; the functions check that themselves.
 */

import { createClient } from "@/lib/supabase/client";
import type { Json, Tables } from "@/lib/supabase/database.types";
import {
  isStudyPhase,
  parseSettings,
  type MyStudyState,
  type PhaseDurations,
  type StudyPhase,
  type StudySession,
  type StartKind,
  type StudyCondition,
  type StudyRunSettings,
  type StudySettings,
} from "@/lib/study/types";
import { emptyPortfolioSchema, emptyStructuredIntent } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const STUDY_KEY = ["study"] as const;
const sessionsKey = [...STUDY_KEY, "sessions"] as const;
const sessionKey = (id: string) => [...STUDY_KEY, "session", id] as const;
const rosterKey = (id: string) => [...STUDY_KEY, "roster", id] as const;
const myStateKey = (id: string) => [...STUDY_KEY, "my-state", id] as const;
const formsKey = (id: string) => [...STUDY_KEY, "forms", id] as const;
const progressKey = (id: string) => [...STUDY_KEY, "progress", id] as const;
const questionnaireKey = (participantId: string, instrument: string) =>
  [...STUDY_KEY, "questionnaire", participantId, instrument] as const;

function rowToSession(row: Tables<"study_sessions">): StudySession {
  return {
    ...row,
    phase: isStudyPhase(row.phase) ? row.phase : "lobby",
    phase_durations: (row.phase_durations ?? {}) as PhaseDurations,
    settings: parseSettings(row.settings),
  };
}

/** Postgres/PostgREST error → a message fit for a toast. */
function asError(error: { message: string } | null): Error | null {
  return error ? new Error(error.message) : null;
}

// ---------------------------------------------------------------------------
// Auth (who is this browser?)
// ---------------------------------------------------------------------------

interface SessionUser {
  id: string;
  isAnonymous: boolean;
}

/** The signed-in user of this browser, or null. */
export function useSessionUser() {
  return useQuery({
    queryKey: [...STUDY_KEY, "session-user"],
    queryFn: async (): Promise<SessionUser | null> => {
      const { data } = await createClient().auth.getUser();
      if (!data.user) return null;
      return { id: data.user.id, isAnonymous: !!data.user.is_anonymous };
    },
    staleTime: 0,
  });
}

/** Sign out (e.g. the facilitator's account before joining as a participant). */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => queryClient.clear(),
  });
}

// ---------------------------------------------------------------------------
// Participant
// ---------------------------------------------------------------------------

interface StudySeat {
  participantId: string;
  sessionId: string;
  displayName: string;
  sessionName: string;
  phase: StudyPhase;
}

/** Sessions this browser has joined (to continue where it left off). */
export function useMySeats(userId: string | undefined) {
  return useQuery({
    queryKey: [...STUDY_KEY, "seats", userId ?? ""],
    queryFn: async (): Promise<StudySeat[]> => {
      const { data, error } = await createClient()
        .from("study_participants")
        .select("id, session_id, display_name, study_sessions(name, phase)")
        .eq("user_id", userId!)
        .order("joined_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        participantId: row.id,
        sessionId: row.session_id,
        displayName: row.display_name,
        sessionName: row.study_sessions?.name ?? "",
        phase: isStudyPhase(row.study_sessions?.phase)
          ? row.study_sessions.phase
          : "lobby",
      }));
    },
    enabled: !!userId,
  });
}

/**
 * Join with code + name. Signs this browser in anonymously first unless it
 * already has a session (re-joining keeps the same seat).
 */
export function useJoinStudy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { code: string; displayName: string }) => {
      const supabase = createClient();
      const { data: current } = await supabase.auth.getUser();
      if (!current.user) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      const { data, error } = await supabase.rpc("join_study_session", {
        p_code: input.code,
        p_display_name: input.displayName,
        p_intent: emptyStructuredIntent() as unknown as Json,
        p_schema: emptyPortfolioSchema() as unknown as Json,
      });
      if (error) throw asError(error);
      const row = data?.[0];
      if (!row) throw new Error("Couldn't join the session");
      return {
        sessionId: row.session_id,
        participantId: row.participant_id,
        portfolioId: row.portfolio_id,
      };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: STUDY_KEY }),
  });
}

interface PanelJoinInput {
  code: string;
  source: string;
  externalId: string;
  studyId: string | null;
  sessionId: string | null;
  /**
   * Local testing only: the arm the link asks for (`arm=<condition>`).
   * Applied only when this server and the database both allow it (see
   * `lib/study/local-arm.ts`); ignored otherwise.
   */
  arm?: StudyCondition | null;
}

/** Local testing: put a new seat into the arm the link names, if allowed. */
async function forceArm(sessionId: string, arm: StudyCondition): Promise<void> {
  try {
    const res = await fetch("/api/study/local-arm", { cache: "no-store" });
    const { allowed } = (await res.json()) as { allowed?: boolean };
    if (!allowed) return;
    const { error } = await createClient().rpc("force_my_study_arm", {
      p_session_id: sessionId,
      p_arm: arm,
    });
    if (error) console.warn("[study] arm not forced:", error.message);
  } catch (error) {
    console.warn("[study] arm not forced:", error);
  }
}

/**
 * Join from a panel link (Prolific): no name to type — the participant gets
 * a neutral one and a condition (migration 013). Rejoining with the same
 * panel id, even from another browser, continues the same seat.
 *
 * A query, not a mutation: it starts by itself when the join page opens, and
 * a mutation started from an effect loses its result when React remounts the
 * component in development. The call is idempotent, so running it again
 * (retry, remount) returns the same seat.
 */
export function usePanelJoin(input: PanelJoinInput) {
  return useQuery({
    queryKey: [...STUDY_KEY, "panel-join", input.code, input.source, input.externalId, input.arm ?? null],
    queryFn: async () => {
      const supabase = createClient();
      const { data: current } = await supabase.auth.getUser();
      if (!current.user) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      const { data, error } = await supabase.rpc("join_study_session_external", {
        p_code: input.code,
        p_source: input.source,
        p_external_id: input.externalId,
        p_external_study_id: input.studyId,
        p_external_session_id: input.sessionId,
        p_intent: emptyStructuredIntent() as unknown as Json,
        p_schema: emptyPortfolioSchema() as unknown as Json,
      });
      if (error) throw asError(error);
      const row = data?.[0];
      if (!row) throw new Error("Couldn't join the session");
      if (input.arm) await forceArm(row.session_id, input.arm);
      return {
        sessionId: row.session_id,
        participantId: row.participant_id,
        portfolioId: row.portfolio_id,
      };
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export interface MyStudyStateWithClock extends Omit<MyStudyState, "server_now"> {
  /** server time − client time (rounded to seconds), for countdowns */
  clockOffsetMs: number;
}

/** The participant shell's poll: phase, timer, settings, own seat. */
export function useMyStudyState(sessionId: string | undefined) {
  return useQuery({
    queryKey: myStateKey(sessionId ?? ""),
    queryFn: async (): Promise<MyStudyStateWithClock | null> => {
      const sentAt = Date.now();
      const { data, error } = await createClient().rpc("get_my_study_state", {
        p_session_id: sessionId!,
      });
      if (error) {
        if (error.code === "22P02") return null; // malformed id
        throw error;
      }
      if (!data) return null;
      const { server_now, ...state } = data as unknown as MyStudyState;
      const clientMid = (sentAt + Date.now()) / 2;
      // Rounded and without the raw timestamp, an unchanged poll is deeply
      // equal to the last one, so React Query keeps the same object and the
      // workspace below doesn't re-render every 2 s.
      const offset = new Date(server_now).getTime() - clientMid;
      return {
        ...state,
        session: {
          ...state.session,
          phase: isStudyPhase(state.session.phase) ? state.session.phase : "lobby",
          settings: parseSettings(state.session.settings),
        },
        clockOffsetMs: Math.round(offset / 1000) * 1000,
      };
    },
    enabled: !!sessionId,
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

/**
 * Briefs session: move this participant on from the step on their screen.
 * Idempotent on the server, so a double click moves one step.
 */
export function useAdvanceStudyStep(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { from: string; reason?: "timeout" }) => {
      const { data, error } = await createClient().rpc("advance_my_study_step", {
        p_session_id: sessionId,
        p_from: input.from,
        p_reason: input.reason,
      });
      if (error) throw asError(error);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: myStateKey(sessionId) }),
  });
}

/** Briefs session: the participant doesn't consent; their seat is closed. */
export function useDeclineStudy(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient().rpc("decline_my_study", {
        p_session_id: sessionId,
      });
      if (error) throw asError(error);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: myStateKey(sessionId) }),
  });
}

export interface StudyFormCard {
  participantId: string;
  portfolioId: string;
  ownerName: string;
  title: string;
  fieldCount: number;
  answeredByMe: boolean;
}

/** Peer forms for the answer gallery (never the caller's own). */
export function useStudyForms(sessionId: string | undefined) {
  return useQuery({
    queryKey: formsKey(sessionId ?? ""),
    queryFn: async (): Promise<StudyFormCard[]> => {
      const { data, error } = await createClient().rpc("get_study_forms", {
        p_session_id: sessionId!,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        participantId: row.participant_id,
        portfolioId: row.portfolio_id,
        ownerName: row.owner_name,
        title: row.title,
        fieldCount: row.field_count ?? 0,
        answeredByMe: row.answered_by_me,
      }));
    },
    enabled: !!sessionId,
    refetchInterval: 10_000,
  });
}

/** After answering a peer form: refresh the gallery's "answered" marks. */
export function useInvalidateStudyForms() {
  const queryClient = useQueryClient();
  return (sessionId: string) =>
    queryClient.invalidateQueries({ queryKey: formsKey(sessionId) });
}

/** Whether this participant already submitted `instrument`. */
export function useMyQuestionnaire(
  participantId: string | undefined,
  instrument: string,
) {
  return useQuery({
    queryKey: questionnaireKey(participantId ?? "", instrument),
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("study_questionnaire_responses")
        .select("id, submitted_at")
        .eq("participant_id", participantId!)
        .eq("instrument", instrument)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!participantId,
  });
}

export function useSubmitQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      participantId: string;
      instrument: string;
      answers: Record<string, unknown>;
    }) => {
      const { error } = await createClient()
        .from("study_questionnaire_responses")
        .insert({
          session_id: input.sessionId,
          participant_id: input.participantId,
          instrument: input.instrument,
          answers: JSON.parse(JSON.stringify(input.answers)) as Json,
        });
      if (error) {
        if (error.code === "23505") return; // already submitted
        throw asError(error);
      }
    },
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({
        queryKey: questionnaireKey(input.participantId, input.instrument),
      }),
  });
}

// ---------------------------------------------------------------------------
// Facilitator (app admin)
// ---------------------------------------------------------------------------

export function useStudySessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: async (): Promise<StudySession[]> => {
      const { data, error } = await createClient()
        .from("study_sessions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(rowToSession);
    },
  });
}

/** One session, polled so the console and presenter screen stay live. */
export function useStudySession(id: string | undefined) {
  return useQuery({
    queryKey: sessionKey(id ?? ""),
    queryFn: async (): Promise<StudySession | null> => {
      const { data, error } = await createClient()
        .from("study_sessions")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) {
        if (error.code === "22P02") return null;
        throw error;
      }
      return data ? rowToSession(data) : null;
    },
    enabled: !!id,
    refetchInterval: 3_000,
  });
}

export function useCreateStudySession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      phaseDurations?: PhaseDurations;
      settings?: Partial<StudySettings>;
    }): Promise<StudySession> => {
      const { data, error } = await createClient().rpc("create_study_session", {
        p_name: input.name,
        p_phase_durations: (input.phaseDurations ?? null) as Json,
        p_settings: (input.settings ?? null) as Json,
      });
      if (error) throw asError(error);
      return rowToSession(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionsKey });
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
    },
  });
}

/** Name, settings and planned durations (not the phase — see useAdvanceStudyPhase). */
/**
 * The session's panel completion URL (admin-only, migration 013). Kept out
 * of `settings` because participants can read those.
 */
export function useCompletionUrl(sessionId: string) {
  return useQuery({
    queryKey: [...sessionKey(sessionId), "completion-url"],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await createClient()
        .from("study_session_secrets")
        .select("completion_url")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (error) throw asError(error);
      return data?.completion_url ?? null;
    },
  });
}

export function useSaveCompletionUrl(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (url: string | null) => {
      const { error } = await createClient()
        .from("study_session_secrets")
        .upsert({
          session_id: sessionId,
          completion_url: url,
          updated_at: new Date().toISOString(),
        });
      if (error) throw asError(error);
      return url;
    },
    onSuccess: (url) =>
      queryClient.setQueryData([...sessionKey(sessionId), "completion-url"], url),
  });
}

export function useUpdateStudySession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      settings?: StudySettings;
      phaseDurations?: PhaseDurations;
    }): Promise<StudySession> => {
      const update: { name?: string; settings?: Json; phase_durations?: Json } = {};
      if (input.name !== undefined) update.name = input.name;
      if (input.settings) {
        // What the session runs with is the server's record (written when
        // the study is opened): a settings form that was loaded earlier
        // must not overwrite it
        const { data: current, error: readError } = await createClient()
          .from("study_sessions")
          .select("settings")
          .eq("id", input.id)
          .single();
        if (readError) throw asError(readError);
        const run = (current.settings as { run?: Json } | null)?.run ?? null;
        update.settings = { ...input.settings, run } as unknown as Json;
      }
      if (input.phaseDurations) {
        update.phase_durations = input.phaseDurations as unknown as Json;
      }
      const { data, error } = await createClient()
        .from("study_sessions")
        .update(update)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw asError(error);
      return rowToSession(data);
    },
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKey(session.id), session);
      queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}

/** Move the whole room to `phase` (snapshots forms when leaving create/review). */
export function useAdvanceStudyPhase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      phase: StudyPhase;
    }): Promise<StudySession> => {
      const { data, error } = await createClient().rpc("advance_study_phase", {
        p_session_id: input.sessionId,
        p_phase: input.phase,
      });
      if (error) throw asError(error);
      return rowToSession(data);
    },
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKey(session.id), session);
      queryClient.invalidateQueries({ queryKey: sessionsKey });
      queryClient.invalidateQueries({ queryKey: rosterKey(session.id) });
    },
  });
}

type ServerRunSettings =
  | { run: StudyRunSettings; missing: [] }
  | { run: null; missing: string[] };

/**
 * What a briefs session would run with (model, question strategy, committee
 * size), from the server's environment — or which of them are not set.
 */
export function useServerRunSettings(sessionId: string, enabled = true) {
  return useQuery({
    queryKey: [...sessionKey(sessionId), "run-settings"],
    queryFn: async (): Promise<ServerRunSettings> => {
      const res = await fetch(`/api/study/sessions/${sessionId}/open`);
      if (!res.ok) throw new Error("Couldn't read the server's settings");
      return (await res.json()) as ServerRunSettings;
    },
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Open a briefs session. The server records what it runs with first and
 * refuses when that isn't set explicitly (see /api/study/sessions/[id]/open).
 */
export function useOpenBriefsSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string): Promise<StudySession> => {
      const res = await fetch(`/api/study/sessions/${sessionId}/open`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        session?: Parameters<typeof rowToSession>[0];
        error?: string;
      };
      if (!res.ok || !body.session) {
        throw new Error(body.error ?? "Couldn't open the study");
      }
      return rowToSession(body.session);
    },
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKey(session.id), session);
      queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}

export interface HandoffCandidate {
  portfolioId: string;
  participant: string;
  condition: string | null;
  brief: string;
  fieldCount: number;
  decisions: number;
  finishedAt: string;
}

/** Finished forms of a briefs session: what a wave-2 session can start from. */
export function useHandoffCandidates(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: [...sessionKey(sessionId ?? ""), "handoff-candidates"],
    queryFn: async (): Promise<HandoffCandidate[]> => {
      const { data, error } = await createClient().rpc("get_study_handoff_candidates", {
        p_session_id: sessionId!,
      });
      if (error) throw asError(error);
      return (data ?? []).map((row) => ({
        portfolioId: row.portfolio_id,
        participant: row.participant,
        condition: row.condition,
        brief: row.brief,
        fieldCount: row.field_count,
        decisions: row.decisions,
        finishedAt: row.finished_at,
      }));
    },
    enabled: !!sessionId,
  });
}

export function useExtendStudyPhase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      seconds: number;
    }): Promise<StudySession> => {
      const { data, error } = await createClient().rpc("extend_study_phase", {
        p_session_id: input.sessionId,
        p_seconds: input.seconds,
      });
      if (error) throw asError(error);
      return rowToSession(data);
    },
    onSuccess: (session) => queryClient.setQueryData(sessionKey(session.id), session),
  });
}

export type RosterEntry = {
  participantId: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
  rejoinUntil: string | null;
  portfolioId: string | null;
  title: string | null;
  fieldCount: number;
  revision: number;
  probesResolved: number;
  responsesGiven: number;
  responsesReceived: number;
  questionnaireDone: boolean;
};

/** Live progress per participant (console, presenter screen). */
export function useStudyRoster(sessionId: string | undefined) {
  return useQuery({
    queryKey: rosterKey(sessionId ?? ""),
    queryFn: async (): Promise<RosterEntry[]> => {
      const { data, error } = await createClient().rpc("get_study_roster", {
        p_session_id: sessionId!,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        participantId: row.participant_id,
        displayName: row.display_name,
        joinedAt: row.joined_at,
        lastSeenAt: row.last_seen_at,
        rejoinUntil: row.rejoin_until,
        portfolioId: row.portfolio_id,
        title: row.title,
        fieldCount: row.field_count ?? 0,
        revision: row.revision ?? 0,
        probesResolved: row.probes_resolved,
        responsesGiven: row.responses_given,
        responsesReceived: row.responses_received,
        questionnaireDone: row.questionnaire_done,
      }));
    },
    enabled: !!sessionId,
    refetchInterval: 3_000,
  });
}

export interface ProgressTask {
  position: number;
  brief: string;
  portfolioId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  finishedBy: string | null;
  fieldCount: number;
  /** Wave 2: what the task's form started as, and from which form */
  startKind: StartKind | null;
  sourcePortfolioId: string | null;
}

export interface ProgressEntry {
  participantId: string;
  displayName: string;
  condition: string | null;
  taskOrder: number | null;
  step: string | null;
  outcome: string | null;
  joinedAt: string;
  lastSeenAt: string;
  completedAt: string | null;
  tasks: ProgressTask[];
}

/** Briefs session: where every participant is (researcher's console). */
export function useStudyProgress(sessionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: progressKey(sessionId ?? ""),
    queryFn: async (): Promise<ProgressEntry[]> => {
      const { data, error } = await createClient().rpc("get_study_progress", {
        p_session_id: sessionId!,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        participantId: row.participant_id,
        displayName: row.display_name,
        condition: row.condition,
        taskOrder: row.task_order,
        step: row.step,
        outcome: row.outcome,
        joinedAt: row.joined_at,
        lastSeenAt: row.last_seen_at,
        completedAt: row.completed_at,
        tasks: (
          (row.tasks ?? []) as unknown as {
            position: number;
            brief: string;
            portfolio_id: string | null;
            started_at: string | null;
            finished_at: string | null;
            finished_by: string | null;
            field_count: number | null;
            start_kind?: StartKind | null;
            source_portfolio_id?: string | null;
          }[]
        ).map((t) => ({
          position: t.position,
          brief: t.brief,
          portfolioId: t.portfolio_id,
          startedAt: t.started_at,
          finishedAt: t.finished_at,
          finishedBy: t.finished_by,
          fieldCount: t.field_count ?? 0,
          startKind: t.start_kind ?? null,
          sourcePortfolioId: t.source_portfolio_id ?? null,
        })),
      }));
    },
    enabled: !!sessionId && enabled,
    refetchInterval: 5_000,
  });
}

/** Let a participant re-enter from another browser under the same name. */
export function useReassignSeat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; participantId: string }) => {
      const { error } = await createClient().rpc("reassign_study_seat", {
        p_participant_id: input.participantId,
      });
      if (error) throw asError(error);
    },
    onSuccess: (_data, input) =>
      queryClient.invalidateQueries({ queryKey: rosterKey(input.sessionId) }),
  });
}

// ---------------------------------------------------------------------------
// Export (facilitator): everything recorded for a session
// ---------------------------------------------------------------------------

const PAGE = 1000;

/** Page through a PostgREST query (default limit is 1000 rows). */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Ids per request: a long `in.(…)` list would exceed the URL limit. */
const ID_CHUNK = 80;

/** Run `query` per chunk of ids and concatenate (keeps each chunk's order). */
async function fetchByIds<T>(
  ids: string[],
  query: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    rows.push(...(await fetchAll((from, to) => query(chunk, from, to))));
  }
  return rows;
}

export interface StudyExport {
  exportedAt: string;
  session: Tables<"study_sessions">;
  participants: Tables<"study_participants">[];
  portfolios: Tables<"portfolios">[];
  snapshots: Tables<"study_snapshots">[];
  responses: Tables<"responses">[];
  provenance: Tables<"provenance_log">[];
  designProbes: Tables<"design_probes">[];
  events: Tables<"study_events">[];
  questionnaires: Tables<"study_questionnaire_responses">[];
  /**
   * Conditions and panel ids (migration 013). Panel ids are personal data:
   * keep the export out of shared folders and repos.
   */
  assignments: Tables<"study_assignments">[];
  /** Briefs sessions (migration 014): one row per participant and brief */
  tasks: Tables<"study_tasks">[];
  progress: Tables<"study_progress">[];
}

export function useStudyExport() {
  return useMutation({
    mutationFn: async (sessionId: string): Promise<StudyExport> => {
      const supabase = createClient();
      const { data: session, error } = await supabase
        .from("study_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();
      if (error) throw error;

      const participants = await fetchAll((from, to) =>
        supabase
          .from("study_participants")
          .select("*")
          .eq("session_id", sessionId)
          .order("joined_at")
          .range(from, to),
      );
      const [tasks, progress] = await Promise.all([
        fetchAll((from, to) =>
          supabase
            .from("study_tasks")
            .select("*")
            .eq("session_id", sessionId)
            .order("position")
            .range(from, to),
        ),
        fetchAll((from, to) =>
          supabase
            .from("study_progress")
            .select("*")
            .eq("session_id", sessionId)
            .range(from, to),
        ),
      ]);
      // A briefs participant has one form per task
      const portfolioIds = [
        ...new Set(
          [...participants.map((p) => p.portfolio_id), ...tasks.map((t) => t.portfolio_id)].filter(
            (id): id is string => !!id,
          ),
        ),
      ];

      const [
        portfolios,
        snapshots,
        responses,
        provenance,
        designProbes,
        events,
        questionnaires,
        assignments,
      ] = await Promise.all([
          fetchByIds(portfolioIds, (ids, from, to) =>
            supabase.from("portfolios").select("*").in("id", ids).order("id").range(from, to),
          ),
          fetchAll((from, to) =>
            supabase
              .from("study_snapshots")
              .select("*")
              .eq("session_id", sessionId)
              .order("created_at")
              .range(from, to),
          ),
          fetchByIds(portfolioIds, (ids, from, to) =>
            supabase
              .from("responses")
              .select("*")
              .in("portfolio_id", ids)
              .order("submitted_at")
              .order("id")
              .range(from, to),
          ).then((rows) =>
            rows.sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? "")),
          ),
          fetchByIds(portfolioIds, (ids, from, to) =>
            supabase
              .from("provenance_log")
              .select("*")
              .in("portfolio_id", ids)
              .order("created_at")
              .order("id")
              .range(from, to),
          ).then((rows) =>
            rows.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")),
          ),
          fetchByIds(portfolioIds, (ids, from, to) =>
            supabase
              .from("design_probes")
              .select("*")
              .in("portfolio_id", ids)
              .order("created_at")
              .order("id")
              .range(from, to),
          ).then((rows) =>
            rows.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")),
          ),
          fetchAll((from, to) =>
            supabase
              .from("study_events")
              .select("*")
              .eq("session_id", sessionId)
              .order("id")
              .range(from, to),
          ),
          fetchAll((from, to) =>
            supabase
              .from("study_questionnaire_responses")
              .select("*")
              .eq("session_id", sessionId)
              .order("submitted_at")
              .range(from, to),
          ),
          fetchAll((from, to) =>
            supabase
              .from("study_assignments")
              .select("*")
              .eq("session_id", sessionId)
              .order("created_at")
              .range(from, to),
          ),
        ]);

      return {
        exportedAt: new Date().toISOString(),
        session,
        participants,
        portfolios,
        snapshots,
        responses,
        provenance,
        designProbes,
        events,
        questionnaires,
        assignments,
        tasks,
        progress,
      };
    },
  });
}
