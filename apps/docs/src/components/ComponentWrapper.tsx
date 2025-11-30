import { cn } from "@/lib/util/cn";
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
    <div className={cn(className)}>
      <h3 className="text-xl">{title}</h3>
      <p className="mb-4">{description}</p>
      <div className="bg-slate-100 p-8 rounded-xl">{children}</div>
    </div>
  );
};
