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
      <div className="mb-6 space-y-2">
        <h3 className="text-2xl font-semibold tracking-tight text-foreground font-sans">
          {title}
        </h3>
        <p className="text-base text-muted-foreground leading-relaxed max-w-3xl">
          {description}
        </p>
      </div>
      <div className="bg-linear-to-br from-slate-50 to-slate-100/50 dark:from-slate-900 dark:to-slate-800/50 p-8 rounded-2xl border border-border shadow-sm">
        {children}
      </div>
    </div>
  );
};
