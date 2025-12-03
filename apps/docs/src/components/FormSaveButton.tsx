"use client";

import { cn } from "@/lib/utils";
import { CheckIcon, Loader2 } from "lucide-react";
import { useFormState } from "react-hook-form";
import { Button } from "./ui/button";

export const FormSaveButton = ({
  children,
  loadingText,
  singleSubmit,
  className,

  ...props
}: {
  children?: React.ReactNode;
  loadingText?: string;
  singleSubmit?: boolean;
} & Parameters<typeof Button>[0]) => {
  const { isSubmitting, isDirty, isValid, submitCount, isSubmitSuccessful } =
    useFormState();

  const classes = cn("w-full md:w-[unset]", className);

  if (singleSubmit && isSubmitSuccessful) {
    return (
      <Button type="submit" disabled className={classes} {...props}>
        <CheckIcon className="mr-2 h-4 w-4" />
        Submitted
      </Button>
    );
  }
  return (
    <Button
      type="submit"
      className={classes}
      disabled={!isDirty || (!isValid && submitCount > 0) || isSubmitting}
      {...props}
    >
      {!!isSubmitting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {loadingText ?? "Loading"}
        </>
      ) : (
        <>{children ?? "Submit"}</>
      )}
    </Button>
  );
};
