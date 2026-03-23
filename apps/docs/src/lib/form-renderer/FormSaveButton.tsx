"use client";

import { Button, type ButtonProps } from "@/components/ui/button";
import { CheckIcon, Loader2, SaveIcon } from "lucide-react";
import { useFormState } from "react-hook-form";
import { cn } from "../utils";

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
} & ButtonProps) => {
  const { isSubmitting, isDirty, isValid, submitCount, isSubmitSuccessful } =
    useFormState();

  const classes = cn("w-full md:w-[unset]", className);

  if (singleSubmit && isSubmitSuccessful) {
    return (
      <Button type="submit" disabled className={classes} {...props}>
        <CheckIcon className="mr-2 h-4 w-4" />
        {"submitted"}
      </Button>
    );
  }

  return (
    <Button
      type="submit"
      data-testid="form-submit-btn"
      className={classes}
      disabled={!isDirty || (!isValid && submitCount > 0) || isSubmitting}
      {...props}
    >
      {!!isSubmitting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {loadingText ?? "loading"}
        </>
      ) : (
        <>
          {children ?? (
            <>
              <SaveIcon className="h-4 w-4 mr-2" />
              Submit
            </>
          )}
        </>
      )}
    </Button>
  );
};
