"use client";

import type { ParseRawDataResponse } from "@/app/actions/schema-actions";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFillingQueue } from "@/hooks/form/use-filling-queue";
import { useFormFilling } from "@/hooks/form/use-form-filling";
import { getFieldAIClassesByFlags } from "@/lib/ai-form-styles";
import type { FillingQueueItem } from "@/lib/form-filling-types";
import type { SerializedSchema } from "@/lib/schema-manager";
import { serializeSchemaToZod } from "@/lib/schema-manager";
import { zodResolver } from "@hookform/resolvers/zod";
import { SaveIcon, Settings2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FieldValueReviewDialog } from "./FieldValueReviewDialog";
import { FillFormDialog } from "./FillFormDialog";
import { FormFillReviewDialog } from "./FormFillReviewDialog";

interface DynamicFormProps {
  schema: SerializedSchema;
  onFieldModify: (fieldKey: string) => void;
  onSubmit: (data: Record<string, unknown>) => void;
  onSchemaUpdate?: (newSchema: SerializedSchema) => void;
}

export function DynamicForm({
  schema,
  onFieldModify,
  onSubmit,
  onSchemaUpdate,
}: DynamicFormProps) {
  const zodSchema = serializeSchemaToZod(schema);

  const form = useForm({
    resolver: zodResolver(zodSchema),
    defaultValues: {},
  });

  // Dialog states
  // TODO: let's continue playing around with the interactions but at some point, I want to condense these dialogs into a single one instead.
  const [fillDialogOpen, setFillDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [parseResult, setParseResult] = useState<ParseRawDataResponse | null>(
    null,
  );
  const [fieldReviewDialogOpen, setFieldReviewDialogOpen] = useState(false);
  const [selectedFieldForReview, setSelectedFieldForReview] =
    useState<FillingQueueItem | null>(null);

  // Store the current filling queue for field review
  const [currentQueue, setCurrentQueue] = useState<FillingQueueItem[]>([]);

  // Memoize config to prevent re-creating on every render
  const fillingConfig = useMemo(
    () => ({
      highlightDuration: 2000,
      fieldDelay: 600,
    }),
    [],
  );

  // Use custom hooks for form filling
  const { buildQueue } = useFillingQueue({ schema, form });
  const filling = useFormFilling({
    form,
    config: fillingConfig,
  });

  const handleSubmit = (data: Record<string, unknown>) => {
    onSubmit(data);
    form.reset();
  };

  // Handle field click to review
  const handleFieldClick = (fieldKey: string) => {
    // Check if field is clickable using hook utility
    if (!filling.isFieldClickable(fieldKey)) {
      return;
    }

    // Find the item in the queue
    const item = currentQueue.find((item) => item.key === fieldKey);
    if (!item) return;

    // Pause filling if active
    if (filling.fillingStatus === "filling") {
      filling.pauseFilling();
    }

    // Show review dialog
    setSelectedFieldForReview(item);
    setFieldReviewDialogOpen(true);
  };

  const handleFieldReviewAccept = (
    editedValue: unknown,
    userNotes?: string,
  ) => {
    if (!selectedFieldForReview) return;

    // Update the value
    form.setValue(selectedFieldForReview.key, editedValue);

    // Log user notes if provided
    if (userNotes) {
      console.log(`User notes for ${selectedFieldForReview.key}:`, userNotes);
    }

    // Close dialog
    setFieldReviewDialogOpen(false);
    setSelectedFieldForReview(null);

    // Resume filling if it was paused
    if (filling.fillingStatus === "paused") {
      filling.resumeFilling();
    }

    toast.success(`Field "${selectedFieldForReview.key}" updated`);
  };

  const handleFieldReviewDecline = () => {
    if (!selectedFieldForReview) return;

    // Revert to previous value if it existed
    if (selectedFieldForReview.previousValue !== undefined) {
      form.setValue(
        selectedFieldForReview.key,
        selectedFieldForReview.previousValue,
      );
    } else {
      // Clear the field
      form.resetField(selectedFieldForReview.key);
    }

    // Close dialog
    setFieldReviewDialogOpen(false);
    setSelectedFieldForReview(null);

    // Resume filling if it was paused
    if (filling.fillingStatus === "paused") {
      filling.resumeFilling();
    }

    toast.info(`Field "${selectedFieldForReview.key}" declined`);
  };

  const handleDataParsed = (result: ParseRawDataResponse) => {
    setParseResult(result);
    setReviewDialogOpen(true);
  };

  const handleFillFormOnly = () => {
    if (!parseResult) return;

    const queue = buildQueue(
      parseResult.parsedData,
      [],
      parseResult.fieldExplanations,
    );

    setReviewDialogOpen(false);
    setParseResult(null);

    // Store queue for field review
    setCurrentQueue(queue);

    // Start filling using hook
    filling.startFilling(queue);
    toast.info(`Filling ${queue.length} fields...`);
  };

  const handleUpdateSchemaAndFill = () => {
    if (!parseResult?.schemaSuggestion || !onSchemaUpdate) return;

    // Update schema first
    onSchemaUpdate(parseResult.schemaSuggestion);

    const queue = buildQueue(
      parseResult.parsedData,
      parseResult.extraFields,
      parseResult.fieldExplanations,
    );

    setReviewDialogOpen(false);
    setParseResult(null);

    // Store queue for field review
    setCurrentQueue(queue);

    // Delay to allow schema to update
    setTimeout(() => {
      filling.startFilling(queue);
      toast.info(`Filling ${queue.length} fields with updated schema...`);
    }, 200);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {schema.fields.map((field) => {
          const isHighlighted = filling.highlightedField === field.key;
          const isFilled = filling.filledFields.has(field.key);
          const isClickable = filling.isFieldClickable(field.key);

          return (
            <FormField
              key={field.key}
              control={form.control}
              name={field.key}
              render={({ field: formField }) => (
                <FormItem
                  data-field-key={field.key}
                  data-field-ai-state={filling.getFieldState(field.key)}
                  className={getFieldAIClassesByFlags({
                    isHighlighted,
                    isFilled,
                    isClickable,
                  })}
                  onClick={() => isClickable && handleFieldClick(field.key)}
                >
                  <div className="flex items-center gap-2">
                    <FormLabel>
                      {field.label}
                      {field.required && (
                        <span className="text-destructive ml-1">*</span>
                      )}
                      {isFilled && (
                        <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                          ✓
                        </span>
                      )}
                    </FormLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFieldModify(field.key);
                      }}
                    >
                      <Settings2Icon className="h-3 w-3" />
                      <span className="sr-only">Modify {field.label}</span>
                    </Button>
                  </div>
                  <FormControl>
                    {field.type === "select" && field.validation?.options ? (
                      <Select
                        onValueChange={formField.onChange}
                        defaultValue={formField.value as string}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={`Select ${field.label}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {field.validation.options.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : field.type === "number" ? (
                      <Input
                        type="number"
                        placeholder={field.description}
                        {...formField}
                        value={formField.value as number}
                      />
                    ) : field.type === "date" ? (
                      <Input
                        type="date"
                        placeholder={field.description}
                        {...formField}
                        value={formField.value as string}
                      />
                    ) : field.type === "email" ? (
                      <Input
                        type="email"
                        placeholder={field.description}
                        {...formField}
                        value={formField.value as string}
                      />
                    ) : field.type === "boolean" ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={formField.value as boolean}
                          onChange={(e) => formField.onChange(e.target.checked)}
                        />
                      </div>
                    ) : (
                      <Input
                        type="text"
                        placeholder={field.description}
                        {...formField}
                        value={formField.value as string}
                      />
                    )}
                  </FormControl>
                  {field.description && (
                    <FormDescription>{field.description}</FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          );
        })}

        <div className="flex gap-2">
          <Button type="submit">
            <SaveIcon />
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onFieldModify("new")}
          >
            Add New Field
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setFillDialogOpen(true)}
          >
            Fill from Data
          </Button>
        </div>
      </form>

      {/* TODO In the next step, I want to make a "Drag and Drop" interaction into the full form for a file that would be extraced and filled into the form. So, we would remove the dialog but instead the user can directly just "throw" the file there. */}

      <FillFormDialog
        open={fillDialogOpen}
        onOpenChange={setFillDialogOpen}
        currentSchema={schema}
        onDataParsed={handleDataParsed}
      />

      <FormFillReviewDialog
        open={reviewDialogOpen}
        onOpenChange={setReviewDialogOpen}
        parseResult={parseResult}
        onFillFormOnly={handleFillFormOnly}
        onUpdateSchemaAndFill={handleUpdateSchemaAndFill}
      />

      {selectedFieldForReview && (
        <FieldValueReviewDialog
          open={fieldReviewDialogOpen}
          onOpenChange={setFieldReviewDialogOpen}
          fieldKey={selectedFieldForReview.key}
          fieldLabel={
            schema.fields.find((f) => f.key === selectedFieldForReview.key)
              ?.label || selectedFieldForReview.key
          }
          previousValue={selectedFieldForReview.previousValue}
          newValue={selectedFieldForReview.value}
          aiExplanation={selectedFieldForReview.explanation}
          onAccept={handleFieldReviewAccept}
          onDecline={handleFieldReviewDecline}
        />
      )}
    </Form>
  );
}
