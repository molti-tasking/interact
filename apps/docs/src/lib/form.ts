import z from "zod";

type FieldMeta = {
  fieldName: string;
  type: string;
  description?: string;
  nestedFields?: FieldMeta[];
};
export const getSchemaFormatted = (
  schemaDef: z.ZodObject["def"]["shape"]
): FieldMeta[] =>
  Object.entries(schemaDef).map(([fieldName, zodField]) => {
    if (zodField.type === "object") {
      return {
        fieldName,
        type: zodField.type,
        description: zodField.meta?.()?.description,
        nestedFields: getSchemaFormatted(zodField.def.shape),
      };
    }
    if (zodField.type === "array") {
      if (zodField.def.element.type === "object") {
        return {
          fieldName,
          type: zodField.type,
          description: zodField.meta?.()?.description,
          nestedFields: getSchemaFormatted(zodField.def.element.def.shape),
        };
      }

      return {
        fieldName,
        type: zodField.type,
        description: zodField.meta?.()?.description,
        nestedFields: [
          {
            fieldName: "ELEMENT_NO_NAME",
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

export const getSchemaDescription = (
  schema: ReturnType<typeof z.object>
): string => {
  const globalMeta = schema.def.shape.title.meta()?.description;

  const parsedData = getSchemaFormatted(schema.def.shape);

  return `
  ## ${globalMeta ?? "Form Field Meta Descriptions"}

  The following JSON schema may want to be properly formatted:
  
   ${JSON.stringify(parsedData, null, 2)} 


  `;
};
