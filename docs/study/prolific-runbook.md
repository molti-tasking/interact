# Running the Prolific Study

How to run the between-subjects comparison with the app's self-paced study
mode. Why it is built this way:
[docs/decisions/2026-11-10-prolific-brief-study.md](../decisions/2026-11-10-prolific-brief-study.md)
and [2026-11-13-study-assistant-baseline.md](../decisions/2026-11-13-study-assistant-baseline.md)
(the assistant arm and the post-task measures). To try it on your own
machine first: [local-testing.md](local-testing.md).

## The design

| | |
|---|---|
| Conditions | `full` (Malleable Forms) and `assistant` (a general-purpose chat assistant next to the same canvas: it builds and changes the form itself and decides on its own whether to ask or suggest). Extra arms that can be ticked: the **silent baseline** (`baseline`: one generated form, then free-text change requests the model only carries out) and `no-probes` |
| Task | Two situations, one form each, order counterbalanced, up to 12 minutes per form |
| After each form | With the form hidden: two self-ratings (1–7), free recall ("list everything your form asks"), three "why does your form ask this?" items, then the quiz. Sessions created before 2026-11-13 don't have the first three |
| Assignment | Condition × order, balanced on the server: the emptiest cell first, and among equally empty cells each factor on its own (conditions alternate from the second participant on) |
| Length | About 46 minutes (the consent page says so): consent, intro and situations 3, two forms up to 24, after each form about 5.5 (ratings 0.5, recall 2, why 2, quiz 1), questionnaire 8. An estimate: the scripted local runs only check that the flow works (45–50 s each, machine time). Check it against the first 10 places |
| Questionnaire | SUS, six experience items, one attention check, two open questions, the six-item Need for Cognition scale (NCS-6), two background questions — the same in every condition |
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
   enabled (see the 2026-10-21 decision log), migrations up to 015 applied
   (`pnpm --filter docs db:migrate`).
4. **Model and budget.** Set `LLM_MODEL_NAME`, `PROBE_STRATEGY` (`committee`
   or `prompted`) and `PROBE_COMMITTEE_SIZE` (2 to 6) explicitly on the
   deployment. The session page shows what the study will run with; it
   cannot be opened while one of them is missing. Opening records them in
   the session, and a session that has run refuses to reopen with other
   settings — create a new session instead. They are in every export. Raise the
   gateway's spend limit and set an alert: in the workshop pilot the limit
   ran out mid-session. The full tool makes many more model calls per form
   than the baseline (question drafts, previews, conflict checks); read the
   real cost per participant off the gateway after the first 10 places.
5. **Create the session.** Studies → New session → "Online study
   (self-paced)". Fill in the contact for the consent page, create it, paste
   Prolific's completion URL on the session page. The page warns about
   anything missing.
6. **Try it.** Locally first: `pnpm study:local` prints a link per arm
   ([local-testing.md](local-testing.md)). On the deployment, open the study
   link in a private window with a made-up `PROLIFIC_PID`; `arm=` does not
   work there, so open it until each arm has come up (the "Conditions"
   table shows which cell each test seat took). Create a fresh session for
   the real run, so test seats are not in the data.

## Prolific

- **Study link:** copy it from the session page; choose "I'll use URL
  parameters". It carries `PROLIFIC_PID`, `STUDY_ID` and `SESSION_ID`.
- **Completion:** "I'll redirect them using a URL"; paste that URL into the
  session page.
- **Screeners:** desktop only, fluent English, approval rate 98 % or higher,
  at least 50 submissions, no programming or UX background.
- **Time and pay:** 46 minutes estimated; at £10 per hour about £7.67 each,
  about £1,075 for 140, plus Prolific's fee.
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
| `coding-recall.csv` | raters | one row per recalled line: `matches_field` (question numbers or `none`), `requirement_id` |
| `coding-why.csv` | raters | one row per why item: `score` 0 (no or wrong reason), 1 (plausible but generic), 2 (tied to the situation) |
| `coding-key.csv` | analyst | form code → participant, condition, order, starting point (wave 2), time, counts, quiz score; appended: `rating_know`, `rating_confident`, `recall_lines`, seconds of ratings, recall, why and quiz, `why_origins`, and for `assistant` its turns, question sentences and patches |
| `participants.csv` | analyst | outcome, SUS, `ncs6_score`, attention check, questionnaire items; appended: `seconds_<step>` for every step, and per task the ratings, why origins and assistant counts |
| `why-key.csv` | analyst | per why item: the field and where it came from (`system`, `participant`, `inherited`), to join with the raters' scores |
| `assistant-turns.csv` | analyst | one row per assistant turn: message, reply, question sentences, patch operations, fields added/changed/removed, latency, prompt version |
| `question-answers.csv` | analyst | one row per answered elicitation question (below) |
| `form-diversity.csv`, `form-diversity-pairs.csv` | analyst | how alike the finished forms of an arm are (below) |
| JSON | archive | everything, including Prolific ids: personal data |

Every CSV ends with the columns `model`, `question_strategy` and
`committee_size`; the Markdown file has them in a line under its title, the
JSON under `run`.

**Need for Cognition.** `ncs_1` … `ncs_6` are the items of the NCS-6 (Lins de
Holanda Coelho, Hanel & Wolf 2020, Assessment 27(8)), answered from 1
(extremely uncharacteristic of me) to 5 (extremely characteristic of me).
`ncs6_score` is their mean with `ncs_3` and `ncs_4` reversed.

**Answered questions.** `question-answers.csv` has, per applied answer:
`displayed_position` (0 = first; the order on the card is drawn at random
when the question is stored, a typed answer is last), `model_position`
(where the model had the answer; empty for the added unchanged answer and
for typed answers), `unchanged_answer`, `typed`, `preview_viewed_first` and
`preview_viewed_ms` (the chosen answer's preview on the form, hovered or
focused for at least 300 ms, before it was applied), `answers_previewed`
(how many different answers of that question were looked at that way) and
`seconds_since_shown`. The same information is in the interaction log
(`probe_shown`, `option_previewed`, `probe_answered`); event and column
names there are unchanged.

**Form diversity.** Per situation and condition: the mean pairwise overlap
of the finished forms' field sets (Jaccard; two fields match when they ask
the same thing by the alignment used for committee drafts). `diversity` is
1 − overlap. If suggested answers narrow what people build, the arm that
had them shows a higher overlap. The pairs file has every pair, by form
code.

**Assistant turns.** `question_sentences` counts the sentences of a reply
that end in a question mark (`lib/study/assistant-metrics.ts` has the exact
rule); `patch_ops` is fields added + updated + removed + section placements,
empty when the reply left the form alone. The prompt is versioned
(`prompt_version`).

Each rater fills in every sheet alone, following
[coding-guide.md](coding-guide.md). Then, per sheet:

```sh
pnpm --filter docs study:agreement rater-a/coding-requirements.csv rater-b/coding-requirements.csv
```

The why sheet's `score` gets weighted kappa (linear; quadratic printed too).

Coverage per form = share of its requirements with `in_final_form = 1`;
"arrived later" = `in_final_form = 1` and `in_first_prompt = 0`. Join to
conditions through `coding-key.csv` only after the coding is settled.

## Wave 2: handoff

Wave 2 asks whether a form is easier to take over with its intent portfolio
than without. Participants adapt a form somebody finished in wave 1 to a
variant situation ("a year on": `camp-2`, `foster-2`, drafts like the
wave-1 situations — have them reviewed too).

1. Close the wave-1 session.
2. New session → "Online study" → Starting point: "From a finished form".
   Choose the wave-1 session, then the forms to pass on per situation
   ("Choose all from the full tool", or tick them). Everyone uses the full
   tool; the session page warns if a situation has no forms.
3. Half of the participants get a form with its intent, its answered
   questions and its history (as "Previous author"); half get the same
   fields and nothing else. Starting point × order is balanced, and each
   source form is passed on equally often per starting point.
4. `coding-key.csv` has `start_kind` (`portfolio` or `form`) and
   `source_portfolio_id` per form; the form-diversity files split by
   starting point. Requirements of the variant situations are marked
   `add`, `remove` or `keep` in `briefs.server.ts`.

Wave 1 must use a deployment whose forms are still in the database when
wave 2 starts: the forms are copied when a wave-2 participant joins.

Not done yet for wave 2 (2026-11-13): a wave-2 session created now also
asks the post-task measures, but its why items don't yet prefer the
inherited fields (they are chosen as in wave 1), and there is no local
wave-2 seed in `pnpm study:local`.
