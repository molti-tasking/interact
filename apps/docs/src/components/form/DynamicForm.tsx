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
import type { SerializedSchema } from "@/lib/schema-manager";
import { serializeSchemaToZod } from "@/lib/schema-manager";
import { zodResolver } from "@hookform/resolvers/zod";
import { Settings2Icon } from "lucide-react";
import { useForm } from "react-hook-form";

interface DynamicFormProps {
  schema: SerializedSchema;
  onFieldModify: (fieldKey: string) => void;
  onSubmit: (data: Record<string, unknown>) => void;
}

export function DynamicForm({
  schema,
  onFieldModify,
  onSubmit,
}: DynamicFormProps) {
  const zodSchema = serializeSchemaToZod(schema);

  const form = useForm({
    resolver: zodResolver(zodSchema),
    defaultValues: {},
  });

  const handleSubmit = (data: Record<string, unknown>) => {
    onSubmit(data);
    form.reset();
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
        </div>
      </form>
    </Form>
  );
}
