export type InteractionMode = "direct" | "prompt" | "context";

type InteractionModeMeta = {
  title: string;
  description: string;
};
export const INTERACTION_MODE_META: Record<
  InteractionMode,
  InteractionModeMeta
> = {
  direct: {
    title: "Direct editing",
    description:
      "Click on any text to edit it directly. Your changes are saved automatically.",
  },
  prompt: {
    title: "Prompt based regeneration",
    description:
      "Use natural language to describe changes and let AI regenerate content.",
  },
  context: {
    title: "Context based regeneration",
    description:
      "AI adapts content based on your edits and interaction patterns.",
  },
};

export const INTERACTION_MODES = Object.keys(
  INTERACTION_MODE_META
) as InteractionMode[];
