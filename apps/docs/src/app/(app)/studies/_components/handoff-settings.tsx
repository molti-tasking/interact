"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useHandoffCandidates, useStudySessions } from "@/hooks/query/study";
import { BRIEFS, BRIEF_KEYS, VARIANT_BRIEF_KEYS } from "@/lib/study/briefs";
import { START_KINDS, type StudyHandoff, type StudySettings } from "@/lib/study/types";

const EMPTY_HANDOFF: StudyHandoff = {
  sourceSessionId: null,
  sources: {},
  starts: [...START_KINDS],
};

/**
 * Wave 1 or wave 2. In wave 2 (handoff) every task starts from a form
 * somebody finished in an earlier session: the researcher picks that
 * session and which of its forms are passed on. Half of the participants
 * get a form with its intent and decisions, half the form alone.
 */
export function HandoffSettings({
  settings,
  onSettingsChange,
  disabled,
}: {
  settings: StudySettings;
  onSettingsChange: (next: StudySettings) => void;
  disabled?: boolean;
}) {
  const handoff = settings.handoff;
  const sessions = useStudySessions();
  const candidates = useHandoffCandidates(handoff?.sourceSessionId);
  const sourceSessions = (sessions.data ?? []).filter(
    (s) => s.settings.mode === "briefs" && !s.settings.handoff,
  );

  const setWave = (wave: 1 | 2) =>
    onSettingsChange(
      wave === 1
        ? { ...settings, handoff: null, briefs: BRIEF_KEYS }
        : {
            ...settings,
            handoff: handoff ?? EMPTY_HANDOFF,
            briefs: VARIANT_BRIEF_KEYS,
            // Everyone adapts the form with the full tool; what differs is
            // what they were handed
            conditions: ["full"],
          },
    );

  const setSources = (brief: string, ids: string[]) =>
    handoff &&
    onSettingsChange({
      ...settings,
      handoff: { ...handoff, sources: { ...handoff.sources, [brief]: ids } },
    });

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Starting point</legend>
      <div role="radiogroup" aria-label="Starting point" className="space-y-1.5">
        {(
          [
            [1, "From nothing: participants describe and build each form (wave 1)"],
            [2, "From a finished form: participants adapt a form somebody else built (wave 2)"],
          ] as const
        ).map(([wave, label]) => (
          <label key={wave} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="study-wave"
              data-testid={`wave-${wave}`}
              checked={(handoff ? 2 : 1) === wave}
              onChange={() => setWave(wave)}
              disabled={disabled}
            />
            {label}
          </label>
        ))}
      </div>

      {handoff && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="handoff-source">Forms come from</Label>
            <select
              id="handoff-source"
              data-testid="handoff-source"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={handoff.sourceSessionId ?? ""}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  handoff: { ...handoff, sourceSessionId: e.target.value || null, sources: {} },
                })
              }
              disabled={disabled || sessions.isLoading}
            >
              <option value="">Choose a wave-1 session…</option>
              {sourceSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.join_code})
                </option>
              ))}
            </select>
          </div>

          {handoff.sourceSessionId &&
            settings.briefs.map((brief) => {
              const from = BRIEFS[brief]?.variantOf;
              const forms = (candidates.data ?? []).filter((c) => c.brief === from);
              const chosen = handoff.sources[brief] ?? [];
              return (
                <div key={brief} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {brief}{" "}
                      <span className="font-normal text-muted-foreground">
                        starts from forms built for “{from}” · {chosen.length} of {forms.length}{" "}
                        chosen
                      </span>
                    </p>
                    <button
                      type="button"
                      className="text-xs underline-offset-2 hover:underline disabled:opacity-50"
                      disabled={disabled || forms.length === 0}
                      data-testid={`handoff-all-${brief}`}
                      onClick={() =>
                        setSources(
                          brief,
                          forms.filter((f) => f.condition === "full" || !f.condition).map((f) => f.portfolioId),
                        )
                      }
                    >
                      Choose all from the full tool
                    </button>
                  </div>
                  {candidates.isLoading ? (
                    <p className="text-xs text-muted-foreground">Loading forms…</p>
                  ) : forms.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No finished forms for “{from}” in that session.
                    </p>
                  ) : (
                    <ul className="max-h-40 space-y-1 overflow-y-auto">
                      {forms.map((form) => (
                        <li key={form.portfolioId} className="flex items-center gap-2">
                          <Checkbox
                            id={`handoff-${brief}-${form.portfolioId}`}
                            checked={chosen.includes(form.portfolioId)}
                            onCheckedChange={(checked) =>
                              setSources(
                                brief,
                                checked === true
                                  ? [...chosen, form.portfolioId]
                                  : chosen.filter((id) => id !== form.portfolioId),
                              )
                            }
                            disabled={disabled}
                          />
                          <Label
                            htmlFor={`handoff-${brief}-${form.portfolioId}`}
                            className="text-xs font-normal"
                          >
                            {form.participant} · {form.condition ?? "full"} · {form.fieldCount}{" "}
                            fields · {form.decisions} answered questions
                          </Label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

          <p className="text-xs text-muted-foreground">
            Half of the participants get a form with its intent and its
            decisions, half the same form with its fields only. Starting
            point, order of the situations and the forms passed on are
            balanced. Don&apos;t change this once people have started.
          </p>
        </div>
      )}
    </fieldset>
  );
}
