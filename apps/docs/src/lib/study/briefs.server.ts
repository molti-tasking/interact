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
}

export interface BriefDefinition {
  key: string;
  version: string;
  title: string;
  /** Paragraphs of the story */
  story: string[];
  requirements: BriefRequirement[];
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
};
