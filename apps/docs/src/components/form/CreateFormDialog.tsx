"use client";

import { generateSchemaFromRawDataAction } from "@/app/actions/schema-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  initializeSerializedSchema,
  saveSchema,
  toSlug,
  type SchemaMetadata,
} from "@/lib/schema-manager";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

interface CreateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFormCreated: () => void;
}

// Zod schema for form validation
const createFormSchema = z.object({
  formName: z.string().min(1, "Form name is required"),
  formDescription: z.string().optional(),
  rawData: z.string().optional(),
});

type CreateFormData = z.infer<typeof createFormSchema>;

export function CreateFormDialog({
  open,
  onOpenChange,
  onFormCreated,
}: CreateFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Form</DialogTitle>
          <DialogDescription>
            Create a new malleable form. You can add and modify fields after
            creation using AI.
          </DialogDescription>
        </DialogHeader>
        <div className="no-scrollbar -mx-4 max-h-[80vh] overflow-y-auto px-4">
          <CreateFormForm
            onClose={() => onOpenChange(false)}
            onFormCreated={() => onFormCreated()}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CreateFormForm = ({
  onClose,
  onFormCreated,
}: {
  onFormCreated: () => void;
  onClose: () => void;
}) => {
  const router = useRouter();

  const form = useForm<CreateFormData>({
    resolver: zodResolver(createFormSchema),
    defaultValues: {
      formName: "",
      formDescription: "",
      rawData: "",
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  const rawData = form.watch("rawData");

  const onSubmit = async (data: CreateFormData) => {
    try {
      let newSchema;

      // If raw data is provided, use LLM to generate schema from it
      if (data.rawData?.trim()) {
        const result = await generateSchemaFromRawDataAction({
          formName: data.formName,
          formDescription:
            data.formDescription || `A dynamic form for ${data.formName}`,
          rawData: data.rawData,
        });

        if (result.success && result.schema) {
          const slug = toSlug(data.formName);
          newSchema = {
            slug,
            title: data.formName,
            schema: result.schema,
          };
          saveSchema(newSchema);
        } else {
          toast.error(result.error || "Failed to generate schema from data");
          return;
        }
      } else {
        // Create a minimal schema with a single name field
        const metadata: SchemaMetadata = {
          name: data.formName,
          description:
            data.formDescription || `A dynamic form for ${data.formName}`,
          fields: {
            name: {
              label: "Name",
              description: "Your name",
              type: "string",
              required: true,
            },
          },
        };

        newSchema = initializeSerializedSchema(metadata);
        saveSchema(newSchema);
      }

      toast.success("Form created successfully!");
      onFormCreated();
      reset();
      onClose();

      // Navigate to the new form
      router.push(`/malleable-form/${newSchema.slug}`);
    } catch (error) {
      toast.error("Failed to create form");
      console.error(error);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="formName">Form Name *</Label>
        <Input
          id="formName"
          placeholder="e.g., Customer Feedback, Job Application"
          {...register("formName")}
          disabled={isSubmitting}
        />
        {errors.formName && (
          <p className="text-sm text-destructive">{errors.formName.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="formDescription">Description (optional)</Label>
        <Textarea
          id="formDescription"
          placeholder="Describe what this form is for..."
          {...register("formDescription")}
          disabled={isSubmitting}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="rawData">Example Raw Data (optional)</Label>
        <Textarea
          id="rawData"
          placeholder="Paste example data (e.g., CV, sample form response, JSON data)...&#10;&#10;Example:&#10;John Doe&#10;john@example.com&#10;Senior Developer&#10;5 years experience"
          {...register("rawData")}
          disabled={isSubmitting}
          rows={6}
        />
        <p className="text-xs text-muted-foreground">
          If provided, AI will analyze this data to generate appropriate form
          fields automatically
        </p>
      </div>

      <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
        <strong>Note:</strong>{" "}
        {rawData?.trim()
          ? "AI will generate form fields based on your example data."
          : 'Your form will start with a single "Name" field. You can add more fields and customize the structure using the AI-powered form builder.'}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onClose()}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Form"}
        </Button>
      </DialogFooter>
    </form>
  );
};
