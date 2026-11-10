# Running the Prolific Study

How to run the between-subjects comparison with the app's self-paced study
mode. Why it is built this way:
[docs/decisions/2026-11-10-prolific-brief-study.md](../decisions/2026-11-10-prolific-brief-study.md).

## The design

| | |
|---|---|
| Conditions | `full` (Malleable Forms) and `baseline` (one generated form, then free-text change requests) |
| Task | Two situations, one form each, order counterbalanced, up to 12 minutes per form |
| Assignment | Condition × order, balanced on the server |
| Length | About 35 minutes: consent and intro 3, two tasks up to 24, two quizzes 2, questionnaire 6 |
| Sample | 64 per condition detects d = 0.5 with 80 % power (two-sided t-test); recruit about 140 |

## Before the first participant

1. **Requirement lists.** `apps/docs/src/lib/study/briefs.server.ts` holds
   two draft situations and their requirement lists. Have people who run
   such sign-ups review them, then set `version` to something other than
   `draft-1`. Don't change them once data is collected.
2. **Consent text.** `ConsentView` in
   `apps/docs/src/app/(study)/study/[sessionId]/_components/briefs/steps.tsx`
   is a draft. It says the data is stored in the EU, that Prolific ids are
   deleted after payment, and that anonymised data may be shared. Make it say
   what your ethics approval and deployment actually provide.
3. **Deployment.** A public URL, the database in the EU, anonymous sign-ins
   enabled (see the 2026-10-21 decision log), migration 014 applied
   (`pnpm --filter docs db:migrate`).
4. **Model and budget.** Set `LLM_MODEL_NAME` and `PROBE_STRATEGY` explicitly
   on the deployment and don't change them during data collection. Raise the
   gateway's spend limit and set an alert: in the workshop pilot the limit
   ran out mid-session. The full tool makes many more model calls per form
   than the baseline (probe drafts, previews, conflict checks); read the
   real cost per participant off the gateway after the first 10 places.
5. **Create the session.** Studies → New session → "Online study
   (self-paced)". Fill in the contact for the consent page, create it, paste
   Prolific's completion URL on the session page. The page warns about
   anything missing.
6. **Try it.** Open the study link in a private window with a made-up
   `PROLIFIC_PID`, once per condition. The "Conditions" table shows which
   cell each test seat took. Create a fresh session for the real run, so
   test seats are not in the data.

## Prolific

- **Study link:** copy it from the session page; choose "I'll use URL
  parameters". It carries `PROLIFIC_PID`, `STUDY_ID` and `SESSION_ID`.
- **Completion:** "I'll redirect them using a URL"; paste that URL into the
  session page.
- **Screeners:** desktop only, fluent English, approval rate 98 % or higher,
  at least 50 submissions, no programming or UX background.
- **Time and pay:** 35 minutes estimated; at £10 per hour about £5.83 each,
  about £820 for 140, plus Prolific's fee.
- **Maximum time:** leave Prolific's default; the app itself limits only the
  two tasks.
- **Returns:** someone who declines consent is asked to return the
  submission; they get no completion code.

## Rollout

1. Open the session (session page → "Open the study"), then publish 10
   places.
2. Check, on the session page and in the exports: each cell got seats; task
   times look plausible; forms are not empty; the gateway shows no failed
   calls and acceptable latency; the questionnaire arrived.
3. Release the rest in batches of 30–40. "Pause new starts" stops new people
   without interrupting those who are working.
4. When Prolific shows the study as complete, "Close the study" and export.

## What to exclude

Decide and preregister before looking at condition differences. The export
gives you: `outcome` (completed or not), `attention_passed` (one
instructed-response item), `task_seconds` and `finished_by` per task,
`field_count`, and the interaction log (page hidden for long stretches shows
as `visibility` events).

## Analysis files

From the session page's Export card:

| File | For | Contents |
|---|---|---|
| `coding-forms.md` | raters | every finished form under a code, with the first description |
| `coding-requirements.csv` | raters | one row per form and requirement: `in_first_prompt`, `in_final_form` (1/0), `covered_by` |
| `coding-fields.csv` | raters | one row per question: the requirement it serves, or `none` |
| `coding-key.csv` | analyst | form code → participant, condition, order, time, counts, quiz score |
| `participants.csv` | analyst | outcome, SUS, attention check, questionnaire items |
| JSON | archive | everything, including Prolific ids: personal data |

Each rater fills in both sheets alone. Then:

```sh
pnpm --filter docs study:agreement rater-a/coding-requirements.csv rater-b/coding-requirements.csv
```

Coverage per form = share of its requirements with `in_final_form = 1`;
"arrived later" = `in_final_form = 1` and `in_first_prompt = 0`. Join to
conditions through `coding-key.csv` only after the coding is settled.
