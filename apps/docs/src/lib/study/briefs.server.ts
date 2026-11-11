/**
 * The briefs of the panel study: a situation told as a story, and the list
 * of what a form for it has to collect.
 *
 * DRAFT (2026-11-10): both stories and both requirement lists were drafted
 * with the tool's developers, not by domain experts. Before the study runs,
 * have the lists reviewed by people who run such sign-ups, then freeze them
 * (bump `version`) — coverage of these lists is the primary measure.
 *
 * Server-only on purpose. A participant sees the story as an image
 * (`/api/study/brief/<key>`), so it can't be pasted into the tool, and never
 * sees the requirements.
 */

export interface BriefRequirement {
  id: string;
  /** What the form has to collect */
  text: string;
  /**
   * "cued": the story describes a problem that this information solves.
   * "uncued": the story doesn't hint at it; it takes knowledge of such forms.
   */
  kind: "cued" | "uncued";
  /**
   * Variant briefs only — what the taken-over form needs: "add" something
   * new, "remove" something that no longer applies, or "keep" something
   * that must survive the changes. Absent: a wave-1 requirement.
   */
  change?: "add" | "remove" | "keep";
}

export interface BriefDefinition {
  key: string;
  version: string;
  title: string;
  /** Paragraphs of the story */
  story: string[];
  requirements: BriefRequirement[];
  /** Wave 2: the wave-1 brief whose form the participant takes over */
  variantOf?: string;
}

export const BRIEF_DEFINITIONS: Record<string, BriefDefinition> = {
  camp: {
    key: "camp",
    version: "draft-1",
    title: "Holiday football week",
    story: [
      "You volunteer at Riverside Football Club. This August the club runs a holiday football week for children aged 6 to 12, Monday to Friday, at the club's ground. Lunch is provided, and every child gets a camp T-shirt.",
      "Last year parents signed up by email, and it went badly. On the first morning the coaches did not know which child belonged in which age group. One boy had a nut allergy that nobody knew about until lunch. When a girl twisted her ankle, it took half an hour to reach one of her parents.",
      "Some parents only want certain days. A few children are collected by a grandparent or a neighbour, and the coaches were unsure whether they were allowed to hand the children over. The club also takes photos during the week for its website and newsletter.",
      "The club chair has asked you to set up an online sign-up form for parents, so that this year the coaches have what they need before the week starts.",
    ],
    requirements: [
      { id: "camp-01", text: "The child's name", kind: "uncued" },
      { id: "camp-02", text: "The child's age or date of birth (for the age group)", kind: "cued" },
      { id: "camp-03", text: "The name of the parent or guardian signing up", kind: "uncued" },
      { id: "camp-04", text: "A phone number on which a parent can be reached during the day", kind: "cued" },
      { id: "camp-05", text: "A second person to call in an emergency", kind: "cued" },
      { id: "camp-06", text: "Allergies or dietary requirements", kind: "cued" },
      { id: "camp-07", text: "Other medical information the coaches should know (conditions, medication)", kind: "uncued" },
      { id: "camp-08", text: "Which days the child attends", kind: "cued" },
      { id: "camp-09", text: "Who is allowed to collect the child", kind: "cued" },
      { id: "camp-10", text: "The child's T-shirt size", kind: "cued" },
      { id: "camp-11", text: "Whether photos of the child may be taken and published", kind: "cued" },
      { id: "camp-12", text: "An email address for the confirmation and information before the week", kind: "uncued" },
    ],
  },
  foster: {
    key: "foster",
    version: "draft-1",
    title: "Foster homes for cats",
    story: [
      "You help out at Willow Lane Cat Rescue, a small shelter run by volunteers. The shelter is full, so it wants to place cats with foster families who look after them at home for a few weeks until they are adopted.",
      "Until now, people who wanted to foster simply phoned the shelter. That caused trouble. One cat came back after three days because the landlord did not allow pets. Another was placed in a home with a large dog and hid under a bed for a week. A third fosterer went on a two-week holiday shortly after taking a cat.",
      "Some cats need medicine every day or are very shy, and not everyone is comfortable with that. Kittens cannot be left alone for a full working day. The shelter brings food and litter, but the fosterer must be able to get the cat to the shelter's vet in town when needed. Before a cat is placed, a volunteer visits the home.",
      "The shelter manager has asked you to set up an online application form for people who want to foster, so that the volunteers can match cats and homes.",
    ],
    requirements: [
      { id: "foster-01", text: "The applicant's name", kind: "uncued" },
      { id: "foster-02", text: "How to contact the applicant (phone or email)", kind: "uncued" },
      { id: "foster-03", text: "The applicant's address or area (for the home visit)", kind: "cued" },
      { id: "foster-04", text: "Whether they rent, and if so whether the landlord allows pets", kind: "cued" },
      { id: "foster-05", text: "Other animals in the household", kind: "cued" },
      { id: "foster-06", text: "Who else lives in the home (children, other adults)", kind: "uncued" },
      { id: "foster-07", text: "When they can foster, including planned absences", kind: "cued" },
      { id: "foster-08", text: "How long the cat would be alone on a normal day", kind: "cued" },
      { id: "foster-09", text: "Whether they would take a cat that needs medicine or is very shy", kind: "cued" },
      { id: "foster-10", text: "Whether they can get the cat to the vet (transport)", kind: "cued" },
      { id: "foster-11", text: "Their experience with cats", kind: "uncued" },
      { id: "foster-12", text: "When a volunteer can visit the home", kind: "cued" },
    ],
  },

  // -------------------------------------------------------------------------
  // Wave 2 (handoff). DRAFT (2026-11-10), like the two above: written with
  // the tool's developers. The participant takes over a form somebody else
  // built for the wave-1 brief and adapts it to what changed. A requirement
  // is met when the final form does what its text says — for "remove", when
  // the form no longer asks for it (also if the taken-over form never did).
  // -------------------------------------------------------------------------
  "camp-2": {
    key: "camp-2",
    variantOf: "camp",
    version: "draft-1",
    title: "Holiday football week, a year on",
    story: [
      "Last summer a volunteer at Riverside Football Club set up the online sign-up form for the club's holiday football week. She has since moved away, and this year the form is yours. You did not build it.",
      "A few things are different this year. The week now runs at two grounds, Riverside and Mill Road, and parents choose one of them. A bus leaves the town centre every morning for children who need it. On Wednesday afternoon everyone goes to the swimming pool, and the coaches want to know beforehand which children cannot swim.",
      "There are no camp T-shirts this year; every child gets a water bottle instead. And because several families complained about the price, a second child from the same family now pays half.",
      "The club chair has asked you to bring last year's form up to date, without losing what the coaches relied on last year.",
    ],
    requirements: [
      { id: "camp2-01", text: "Which ground the child attends (Riverside or Mill Road)", kind: "cued", change: "add" },
      { id: "camp2-02", text: "Whether the child needs the bus from the town centre", kind: "cued", change: "add" },
      { id: "camp2-03", text: "Whether the child can swim", kind: "cued", change: "add" },
      { id: "camp2-04", text: "Whether a brother or sister is also signed up (for the half price)", kind: "cued", change: "add" },
      { id: "camp2-05", text: "The form no longer asks for a T-shirt size", kind: "cued", change: "remove" },
      { id: "camp2-06", text: "Permission for the child to take part in the swimming afternoon", kind: "uncued", change: "add" },
      { id: "camp2-07", text: "The form still asks for allergies or dietary requirements", kind: "uncued", change: "keep" },
      { id: "camp2-08", text: "The form still asks for a phone number or person to reach in an emergency", kind: "uncued", change: "keep" },
    ],
  },
  "foster-2": {
    key: "foster-2",
    variantOf: "foster",
    version: "draft-1",
    title: "Foster homes, a year on",
    story: [
      "Last year a volunteer at Willow Lane set up the online application form for people who want to foster a cat. He no longer has the time, and the form is now yours. You did not build it.",
      "The shelter has changed since then. It has started taking in rabbits, and it needs foster homes for them too; a rabbit needs room for a hutch, indoors or in a garden. One rabbit came back after a week because a child in the family turned out to be allergic to hay.",
      "The shelter now owns a van and collects animals for the vet itself. Volunteers no longer visit every home: they hold a short video call with the applicant instead.",
      "The shelter manager has asked you to bring the application form up to date, without losing what the volunteers relied on to match animals and homes.",
    ],
    requirements: [
      { id: "foster2-01", text: "Which animals the applicant would foster (cats, rabbits or both)", kind: "cued", change: "add" },
      { id: "foster2-02", text: "Whether there is room for a rabbit hutch (indoors or a garden)", kind: "cued", change: "add" },
      { id: "foster2-03", text: "Allergies in the household (animals, hay)", kind: "cued", change: "add" },
      { id: "foster2-04", text: "When a video call with the applicant can take place", kind: "cued", change: "add" },
      { id: "foster2-05", text: "The form no longer asks when a volunteer can visit the home", kind: "cued", change: "remove" },
      { id: "foster2-06", text: "The form no longer asks whether the applicant can get the animal to the vet", kind: "cued", change: "remove" },
      { id: "foster2-07", text: "The form still asks about other animals in the household", kind: "uncued", change: "keep" },
      { id: "foster2-08", text: "The form still asks whether a landlord allows pets", kind: "uncued", change: "keep" },
    ],
  },
};
