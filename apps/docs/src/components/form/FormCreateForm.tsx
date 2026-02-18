"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { debounce } from "@tanstack/pacer";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

// Zod schema for form validation
const createFormSchema = z.object({
  basePrompt: z.string().optional(),
});

type CreateFormData = z.infer<typeof createFormSchema>;

export const FormCreateForm = ({
  onFormCreated,
}: {
  onFormCreated: () => void;
}) => {
  const form = useForm<CreateFormData>({
    resolver: zodResolver(createFormSchema),
    defaultValues: {
      basePrompt: "",
    },
  });

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = form;

  const onSubmit = async (data: CreateFormData) => {
    console.log(data);
    toast.success("Form created successfully!");
    onFormCreated();
  };

  const onPromptInserted = debounce(
    (text) => {
      console.log("Debounced! -> ", text);
      console.log("TODO: Initiate a smart prompt from here...");
    },
    {
      wait: 300,
    },
  );
  console.log(register("basePrompt"));
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="basePrompt">What you want?</Label>
        <Textarea
          id="basePrompt"
          placeholder="Describe what this form is for..."
          {...register("basePrompt")}
          onChange={(e) => {
            console.log("On change: ", e.target.value);
            onPromptInserted(e.target.value);
          }}
          disabled={isSubmitting}
          rows={3}
        />
      </div>

      <div className="flex flex-row gap-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Form"}
        </Button>
      </div>
    </form>
  );
};
