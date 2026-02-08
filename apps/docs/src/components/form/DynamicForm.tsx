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
import type { SerializedSchema } from "@/lib/schema-manager";
import { serializeSchemaToZod } from "@/lib/schema-manager";
import { zodResolver } from "@hookform/resolvers/zod";
import { Settings2Icon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
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
  const [fillDialogOpen, setFillDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [parseResult, setParseResult] = useState<ParseRawDataResponse | null>(
    null,
  );

  const form = useForm({
    resolver: zodResolver(zodSchema),
    defaultValues: {},
  });

  const handleSubmit = (data: Record<string, unknown>) => {
    onSubmit(data);
    form.reset();
  };

  const handleDataParsed = (result: ParseRawDataResponse) => {
    setParseResult(result);
    setReviewDialogOpen(true);
  };

  const handleFillFormOnly = () => {
    if (!parseResult) return;

    // Pre-fill form with matched data
    Object.entries(parseResult.parsedData).forEach(([key, value]) => {
      // Check if field exists in schema
      const fieldExists = schema.fields.some((f) => f.key === key);
      if (fieldExists) {
        form.setValue(key, value);
      }
    });

    setReviewDialogOpen(false);
    setParseResult(null);
    toast.success(
      `Form filled with ${Object.keys(parseResult.parsedData).length} fields`,
    );
  };

  const handleUpdateSchemaAndFill = () => {
    if (!parseResult?.schemaSuggestion || !onSchemaUpdate) return;

    // Update schema
    onSchemaUpdate(parseResult.schemaSuggestion);

    // Pre-fill form with all data (matched + extra)
    // Note: We need to wait for schema to update before filling extra fields
    // For now, just fill the matched data immediately
    Object.entries(parseResult.parsedData).forEach(([key, value]) => {
      form.setValue(key, value);
    });

    // Fill extra fields (they'll be available after schema update)
    setTimeout(() => {
      parseResult.extraFields.forEach((field) => {
        form.setValue(field.key, field.value);
      });
    }, 100);

    setReviewDialogOpen(false);
    setParseResult(null);
    toast.success("Schema updated and form filled successfully");
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {schema.fields.map((field) => (
          <FormField
            key={field.key}
            control={form.control}
            name={field.key}
            render={({ field: formField }) => (
              <FormItem>
                <div className="flex items-center gap-2">
                  <FormLabel>
                    {field.label}
                    {field.required && (
                      <span className="text-destructive ml-1">*</span>
                    )}
                  </FormLabel>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => onFieldModify(field.key)}
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
        ))}

        <div className="flex gap-2">
          <Button type="submit">Save Registration</Button>
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
      {/* TODO In another next step, I want to artificially delay the form inserts and add a sublte animation to it to show to the user what came up. Maybe we highlight the text in another color for a certain period of time, in order to assume that the user automatically approves it. Or, alternatively provide an easy interaction when the user clicks on it: Open a dialog showing the previous and new value. Also showing WHY the gen AI suggests this value for the field. Then the user will have the option to decline or reiterate with a short prompt to be given into the conversation for the recreation. */}

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
    </Form>
  );
}
