import { PropsWithChildren } from "react";

type ComponentWrapperProps = PropsWithChildren<{
  title: string;
  description: string;
}>;

export const ComponentWrapper = ({
  title,
  description,

  children,
}: ComponentWrapperProps) => {
  return (
    <div>
      <h3 className="text-xl">{title}</h3>
      <p className="mb-4">{description}</p>
      <div className="bg-slate-100 p-8 rounded-xl">{children}</div>
    </div>
  );
};
