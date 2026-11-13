/**
 * Forcing an arm from the study link (`arm=<condition>`), for the authors'
 * local testing only (docs/study/local-testing.md).
 *
 * Two gates, independent of each other:
 *
 * 1. This app: only when `NODE_ENV !== "production"` and `STUDY_LOCAL=1`.
 *    The join page asks `/api/study/local-arm` and otherwise ignores the
 *    parameter.
 * 2. The database: `force_my_study_arm` (migration 017) does nothing unless
 *    `study_local_mode.forced_arms` is set, which only the database owner
 *    can do (the local setup script does). A participant on a deployment
 *    who calls it by hand changes nothing.
 */

import { STUDY_CONDITIONS, type StudyCondition } from "./types";

export function forcedArmAllowed(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV !== "production" && env.STUDY_LOCAL?.trim() === "1";
}

/** The condition a link's `arm` parameter names, or null. */
export function armFromLink(value: string | null | undefined): StudyCondition | null {
  const arm = value?.trim().toLowerCase();
  return STUDY_CONDITIONS.includes(arm as StudyCondition) ? (arm as StudyCondition) : null;
}
