"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { InfoIcon } from "lucide-react";
import z from "zod";
import { ScrollArea } from "../ui/scroll-area";

interface SchemaPromptDialogProps {
  formSchema: ReturnType<typeof z.object>;
}

export function SchemaPromptDialog({ formSchema }: SchemaPromptDialogProps) {
  return (
    <Dialog>
      <DialogTrigger>
        <Button size={"icon"}>
          <InfoIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-4">
            <InfoIcon className={cn("h-5 w-5")} />

            <span>Schema Prompt</span>
          </DialogTitle>
        </DialogHeader>
        <p className="italic text-muted-foreground">
          Below is the auto generated schema prompt based on zod form schema
          meta information. It shall be usable for additional context about the
          schema when passing it to LLM completions.
        </p>
        <ScrollArea className="max-h-[70vh] border bg-purple-50 text-purple-900 rounded-md p-4 mt-4 max-w-2xl w-full">
          <pre>{getSchemaDescription(formSchema)}</pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

const getSchemaDescription = (schema: ReturnType<typeof z.object>): string => {
  const globalMeta = schema.def.shape.title.meta()?.description;

  type FieldMeta = {
    fieldName: string;
    type: string;
    description?: string;
    nestedFields?: FieldMeta[];
  };

  const generateReturnTypeForObject = (
    schemaDef: z.ZodObject["def"]["shape"]
  ): FieldMeta[] =>
    Object.entries(schemaDef).map(([fieldName, zodField]) => {
      if (zodField.type === "object") {
        return {
          fieldName,
          type: zodField.type,
          description: zodField.meta?.()?.description,
          nestedFields: generateReturnTypeForObject(zodField.def.shape),
        };
      }
      if (zodField.type === "array") {
        if (zodField.def.element.type === "object") {
          return {
            fieldName,
            type: zodField.type,
            description: zodField.meta?.()?.description,
            nestedFields: generateReturnTypeForObject(
              zodField.def.element.def.shape
            ),
          };
        }

        return {
          fieldName,
          type: zodField.type,
          description: zodField.meta?.()?.description,
          nestedFields: [
            {
              fieldName: "ELEMENT_ NO NAME",
              type: zodField.def.element.type,
              description: zodField.def.element.meta?.()?.description,
            },
          ],
        };
      }
      return {
        fieldName,
        type: zodField.type,
        description: zodField.meta?.()?.description,
      };
    });

  const parsedData = generateReturnTypeForObject(schema.def.shape);

  return `
  ## ${globalMeta ?? "Form Field Meta Descriptions"}

  The following JSON schema may want to be properly formatted:
  
   ${JSON.stringify(parsedData, null, 2)} 


  `;
};
