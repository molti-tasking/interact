import { cn } from "@/lib/utils";
import { type ClassValue } from "clsx";
import { PropsWithChildren } from "react";

type ComponentWrapperProps = PropsWithChildren<{
  title: string;
  description: string;
  className?: ClassValue;
}>;

export const ComponentWrapper = ({
  title,
  description,
  className,
  children,
}: ComponentWrapperProps) => {
  return (
    <div className={cn("w-full", className)}>
      <h3 className="text-xl">{title}</h3>
      <p className="mb-4">{description}</p>
      <div className="bg-slate-100 p-8 rounded-xl">{children}</div>
    </div>
  );
};
