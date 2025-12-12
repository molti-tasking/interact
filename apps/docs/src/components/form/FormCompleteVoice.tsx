"use client";

import { Button } from "@/components/ui/button";
import { getSchemaFormatted } from "@/lib/form";
import { AudioLinesIcon, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import z from "zod";

interface FormCompleteVoiceProps<FormValues extends FieldValues> {
  form: UseFormReturn<FormValues>;
  formSchema: ReturnType<typeof z.object<FieldValues>>;
  formRef: React.RefObject<HTMLFormElement | null>;
}

export function FormCompleteVoice<FormValues extends FieldValues>({
  form,
  formSchema,
  formRef,
}: FormCompleteVoiceProps<FormValues>) {
  const [isLoading, startTransition] = useTransition();

  const formMeta = getSchemaFormatted(formSchema.def.shape);

  const onRecordVoice = () =>
    startTransition(async () => {
      for (let fieldIndex = 0; fieldIndex < formMeta.length; fieldIndex++) {
        const field = formMeta[fieldIndex];

        const fieldName = field?.fieldName as Path<FormValues>;

        if (fieldName && field.type === "string") {
          await awaitTimeout(500);
          form.setFocus(fieldName);
          const newValue =
            "This is example text" as FormValues[Path<FormValues>];
          form.setValue(fieldName, newValue);

          // const elements = document.getElementsByName(fieldName);
          if (formRef.current) {
            const inputElement = formRef.current.querySelector(
              `[name="${fieldName}"]`
            );
            inputElement?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }
        }
      }
      toast("Updated all fields");
    });
  return (
    <Button onClick={onRecordVoice} disabled={isLoading}>
      {isLoading ? <Loader2 className="animate-spin" /> : <AudioLinesIcon />}{" "}
      Voice Fill
    </Button>
  );
}

const awaitTimeout = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));
