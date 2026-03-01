"use client";

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
import { useFormFilling } from "@/hooks/form/use-form-filling";
import { getFieldAIClassesByFlags } from "@/lib/ai-form-styles";
import type { SerializedSchema } from "@/lib/schema-manager";
import { serializeSchemaToZod } from "@/lib/schema-manager";
import { zodResolver } from "@hookform/resolvers/zod";
import { SaveIcon } from "lucide-react";
import { useMemo } from "react";
import { useForm } from "react-hook-form";

interface DynamicFormRendererProps {
  schema: SerializedSchema;
  onSubmit: (data: Record<string, unknown>) => void;
}

export function DynamicFormRenderer({
  schema,
  onSubmit,
}: DynamicFormRendererProps) {
  const zodSchema = serializeSchemaToZod(schema);

  const form = useForm({
    resolver: zodResolver(zodSchema),
    defaultValues: {},
  });

  // Memoize config to prevent re-creating on every render
  const fillingConfig = useMemo(
    () => ({
      highlightDuration: 2000,
      fieldDelay: 600,
    }),
    [],
  );

  // Use custom hooks for form filling
  const filling = useFormFilling({
    form,
    config: fillingConfig,
  });

  const handleSubmit = (data: Record<string, unknown>) => {
    onSubmit(data);
    form.reset();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {schema.fields.map((field) => {
          const isHighlighted = filling.highlightedField === field.key;
          const isFilled = filling.filledFields.has(field.key);

          console.log("field: ", field.key);
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
                    isClickable: false,
                  })}
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
                          {field.validation.options.map((option) => {
                            if (
                              typeof option === "object" &&
                              "value" in option &&
                              "label" in option
                            ) {
                              const { value, label } = option;
                              return (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              );
                            }

                            return (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            );
                          })}
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
        </div>
      </form>
    </Form>
  );
}
