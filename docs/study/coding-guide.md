# Coding Guide for the Raters

You code the forms and answers of the online study without knowing who made
them or which version of the tool they used. Every file you get names a form
only by its **form code** (six letters and digits). Do not try to find out
which tool a form came from. If an answer gives it away ("the assistant
asked me …"), code it as you would any other answer.

Two raters code every sheet alone. Then compare the sheets:

```sh
pnpm --filter docs study:agreement rater-a/<sheet>.csv rater-b/<sheet>.csv
```

It prints the agreement per coded column (Cohen's kappa; weighted kappa for
the why score) and lists every row you disagree on. Settle those together,
and keep both your original sheets and the settled one.

## Your files

| File | You fill in | One row per |
|---|---|---|
| `coding-forms.md` | nothing: read it | form: the situation, the first description, the final form with numbered questions |
| `coding-requirements.csv` | `in_first_prompt`, `in_final_form`, `covered_by` | form × requirement |
| `coding-fields.csv` | `requirement_id` | question of a final form |
| `coding-recall.csv` | `matches_field`, `requirement_id` | line a participant remembered |
| `coding-why.csv` | `score` | "why does your form ask this?" answer |

The requirement lists of the two situations are in
`apps/docs/src/lib/study/briefs.server.ts` (ids such as `camp-06`). Keep
them open while you code. Do not look at their `kind` (cued or uncued) while
coding.

## Matching rules (all sheets)

A question, a description or a recalled line **covers** a requirement when
someone who answers it, or follows it, gives the information the requirement
names. The wording does not have to match.

1. **Same information, other words** counts: "Who may pick up your child?"
   covers `camp-09`.
2. **More general** counts if the requirement's information is clearly part
   of the answer: "Allergies, diet or medical needs" covers `camp-06` and
   `camp-07`.
3. **More specific** counts only if it gets what the requirement is for: "Nut
   allergy (yes/no)" covers `camp-06` (it is an allergy question); "Does your
   child need sun cream?" does not cover `camp-07`.
4. **One field for two requirements** covers both: "Parent's name and phone"
   covers `camp-03` and `camp-04`.
5. **A field that asks for the right thing about the wrong person** does not
   count: "Your phone number" in the foster form covers `foster-02`, but
   "Emergency contact for the parent" in the camp form covers `camp-05` only
   if it is a second person, not the parent.
6. **Several codes** go in one cell, in ascending order, separated by `;`
   without spaces: `camp-03;camp-04`. For numbers: `2;5`.
7. **Nothing** is `none`, never an empty cell (empty means "not coded yet").

## coding-requirements.csv

For each form and requirement:

- `in_first_prompt`: 1 if the first description (in `coding-forms.md`)
  already asks for it, else 0. The description must say the form should
  collect it; mentioning the topic is not enough ("kids aged 6 to 12" does
  not ask for the child's age).
- `in_final_form`: 1 if a question of the final form covers it, else 0.
- `covered_by`: the number(s) of those questions; empty when 0.

**Example 1.** First description: "A sign-up form for the holiday week. The
coaches need allergies and someone to call in an emergency." Final form
question 4: "Emergency contact (name and phone)".
`camp-06`: `in_first_prompt` 1. `camp-05`: `in_first_prompt` 1,
`in_final_form` 1, `covered_by` 4.

**Example 2.** Foster form, question 7: "Do you rent? If so, does your
landlord allow pets?" `foster-04`: `in_final_form` 1, `covered_by` 7. The
form has no question about planned holidays: `foster-07` `in_final_form` 0.

## coding-fields.csv

For each question of a final form: the requirement(s) it serves, or `none`
for a question that serves no requirement of the list.

**Example 1.** Camp form, "T-shirt size (S, M, L)": `camp-10`.

**Example 2.** Camp form, "How did you hear about the camp?": `none`. Foster
form, "Your phone number or email": `foster-02`.

## coding-recall.csv

After each form, participants listed from memory everything their form asks,
one item per line. For each line:

- `matches_field`: the number(s) of the question(s) of that form (in
  `coding-forms.md`, under the same form code) that the line names, by
  rules 1–7 above; `none` if the form has no such question. A line that
  names a question the form does not have is an important finding: code
  it `none`, don't search for a near match.
- `requirement_id`: the requirement(s) the line names, whether or not the
  form has the question; `none` if it names none.

A line that lists several things ("name, age and allergies") gets every
matching number and every requirement. A line that is no item at all
("that's all", "I don't remember") gets `none` twice.

**Example 1.** Form `K3Q9ZD` (camp), question 2 "Child's date of birth",
question 6 "Allergies or dietary needs". Line "age of the kid" →
`matches_field` 2, `requirement_id` `camp-02`. Line "allergies + medication"
→ `matches_field` 6 (the form has no medication question),
`requirement_id` `camp-06;camp-07`.

**Example 2.** Form `7HD2XA` (foster), no question about other pets. Line
"whether they have other pets" → `matches_field` `none`,
`requirement_id` `foster-05`. Line "contact info" with question 1 "Email"
and question 2 "Phone" → `matches_field` `1;2`, `requirement_id`
`foster-02`.

## coding-why.csv

After each form, participants said why their form asks three of its
questions. Score each answer on how well it gives the reason **in this
situation**:

| Score | Meaning | Typical answers |
|---|---|---|
| **0** | No reason, or a wrong one | "don't know"; repeats the question; "the tool added it"; a reason the situation contradicts; a reason for a different question |
| **1** | Plausible but generic: true of almost any form of this kind | "to contact them"; "for safety"; "it's standard on sign-up forms"; "so we know who they are" |
| **2** | Tied to the situation: a fact or a use from the story | "the coaches didn't know who may collect a child"; "a cat came back because the landlord didn't allow pets"; "kittens can't be left alone all day" |

Score the reason, not the spelling or the length. When an answer has a
generic and a specific part, score the better part. Score only 0, 1 or 2;
the agreement script lists anything else.

**Example 1.** Field "Who is allowed to collect your child?" Answer: "Last
year the coaches weren't sure if a grandparent could take a child home" →
**2**. Answer: "for security reasons" → **1**.

**Example 2.** Field "Do you have a car?" (foster form). Answer: "because the
shelter's vet is in town and the cat must get there" → **2**. Answer: "the
AI suggested it" → **0**. Answer: "to know how they get around" → **1**.
