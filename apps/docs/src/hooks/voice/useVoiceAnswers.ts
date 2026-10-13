"use client";

import { interpretSpokenAnswerAction } from "@/app/actions/spoken-answer-actions";
import {
  matchSpokenAnswer,
  type SpokenAnswer,
  type VoiceQuestion,
} from "@/lib/voice/spoken-answer";
import { loadCaptureMode } from "@/lib/voice-modes";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLiveVoiceCapture } from "./useLiveVoiceCapture";

export interface VoiceAnswerResult {
  heard: string;
  /** What happened, e.g. "Keep email plus date" or "No answer — …" */
  result: string;
  applied: boolean;
}

export interface UseVoiceAnswersOptions {
  /** The open questions in deck order and the one on screen — read per phrase */
  getQuestions: () => { questions: VoiceQuestion[]; currentId: string | null };
  /**
   * Apply one answer. Resolves to a short description of what was applied,
   * or null when it couldn't be (the caller reports why).
   */
  onAnswer: (questionId: string, answer: SpokenAnswer) => Promise<string | null>;
}

/**
 * Answer the deck's questions by talking: while listening, every phrase
 * (cut at pauses, or by the browser recognizer in "live" capture mode) is
 * matched to the question on screen — locally when it's unambiguous, by the
 * LLM otherwise — and applied. Phrases are handled one at a time in the
 * order spoken, so each one sees the deck the previous answer left behind.
 */
export function useVoiceAnswers({ getQuestions, onAnswer }: UseVoiceAnswersOptions) {
  const latest = useRef({ getQuestions, onAnswer });
  useEffect(() => {
    latest.current = { getQuestions, onAnswer };
  });

  const [caption, setCaption] = useState("");
  const [last, setLast] = useState<VoiceAnswerResult | null>(null);
  const [pending, setPending] = useState(0);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  // Answered by voice, while the deck may not show it yet
  const answeredRef = useRef(new Set<string>());
  const previousRef = useRef<{ utterance: string; outcome: string } | null>(
    null,
  );

  const handleSegment = useCallback((text: string) => {
    const heard = text.trim();
    if (!heard) return;
    setCaption("");

    const remember = (result: string, applied: boolean) => {
      setLast({ heard, result, applied });
      previousRef.current = { utterance: heard, outcome: result };
    };

    const answerPhrase = async () => {
      const { questions: all, currentId } = latest.current.getQuestions();
      // Forget questions that left the deck, so one reopened by Undo can be
      // answered again
      const present = new Set(all.map((q) => q.id));
      for (const id of answeredRef.current) {
        if (!present.has(id)) answeredRef.current.delete(id);
      }
      const questions = all.filter((q) => !answeredRef.current.has(q.id));
      if (questions.length === 0) return remember("No open questions", false);
      const current = questions.find((q) => q.id === currentId) ?? questions[0];

      let answers: { questionId: string; answer: SpokenAnswer }[];
      const quick = matchSpokenAnswer(heard, current);
      if (quick) {
        answers = [{ questionId: current.id, answer: quick }];
      } else {
        const response = await interpretSpokenAnswerAction({
          utterance: heard,
          questions,
          currentId: current.id,
          previous: previousRef.current ?? undefined,
        });
        if (!response.success) {
          throw new Error(response.error ?? "Couldn't interpret that");
        }
        answers = response.answers ?? [];
        if (answers.length === 0) {
          return remember(
            response.note ? `No answer — ${response.note}` : "No answer",
            false,
          );
        }
      }

      const applied: string[] = [];
      for (const { questionId, answer } of answers) {
        answeredRef.current.add(questionId);
        const result = await latest.current.onAnswer(questionId, answer);
        if (result === null) answeredRef.current.delete(questionId);
        else applied.push(result);
      }
      remember(
        applied.length > 0 ? applied.join(" · ") : "Couldn't apply that",
        applied.length > 0,
      );
    };

    setPending((n) => n + 1);
    chainRef.current = chainRef.current
      .then(answerPhrase)
      .catch((err) =>
        remember(
          err instanceof Error ? err.message : "Something went wrong",
          false,
        ),
      )
      .finally(() => setPending((n) => n - 1));
  }, []);

  // Private (Whisper only) unless the user opted into live captions in
  // record mode; read once — it only matters when a recording starts
  const [captureMode] = useState(loadCaptureMode);
  const capture = useLiveVoiceCapture({
    onSegment: handleSegment,
    onInterim: setCaption,
    onError: (message, { soft }) => {
      if (!soft) toast.error(message, { id: "voice-answers-error" });
    },
    mode: captureMode,
  });

  const listening = capture.isRecording || capture.isStarting;
  const { toggle: toggleCapture } = capture;
  const toggle = useCallback(() => {
    if (!listening) {
      answeredRef.current.clear();
      previousRef.current = null;
      setLast(null);
    }
    toggleCapture();
  }, [listening, toggleCapture]);

  return {
    listening,
    /** Waiting for microphone permission */
    starting: capture.isStarting,
    /** Phrases being transcribed, interpreted or applied */
    working: capture.isTranscribing || pending > 0,
    /** Live caption of the phrase being spoken ("live" capture mode only) */
    caption,
    last,
    toggle,
  };
}
