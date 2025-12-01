import { InteractionMode } from "interact";
import { Edit3, LucideProps, MessageSquare, Sparkles } from "lucide-react";
import { ForwardRefExoticComponent, RefAttributes } from "react";

type InteractionModeConfig = {
  icon: ForwardRefExoticComponent<
    Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>
  >;
  color: string;
  bgColor: string;
  borderColor: string;
};

export const INTERACTION_MODE_MAP: Record<
  InteractionMode,
  InteractionModeConfig
> = {
  direct: {
    icon: Edit3,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  prompt: {
    icon: MessageSquare,
    color: "text-purple-700",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
  },
  context: {
    icon: Sparkles,
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
  },
};
