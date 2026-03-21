import { getStandardById } from "./standards";
import type { SerializedSchema, SchemaField } from "./schema-manager";

/**
 * Exports a SerializedSchema to JSON Schema (Draft 2020-12).
 * Works for any schema, with or without domain standards applied.
 */
export function exportToJSONSchema(schema: SerializedSchema): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const field of schema.fields) {
    const prop: Record<string, unknown> = {
      title: field.label,
    };

    if (field.description) {
      prop.description = field.description;
    }

    switch (field.type) {
      case "string":
        prop.type = "string";
        if (field.validation?.min) prop.minLength = field.validation.min;
        if (field.validation?.max) prop.maxLength = field.validation.max;
        if (field.validation?.pattern) prop.pattern = field.validation.pattern;
        break;
      case "email":
        prop.type = "string";
        prop.format = "email";
        break;
      case "number":
        prop.type = "number";
        if (field.validation?.min !== undefined)
          prop.minimum = field.validation.min;
        if (field.validation?.max !== undefined)
          prop.maximum = field.validation.max;
        break;
      case "boolean":
        prop.type = "boolean";
        break;
      case "date":
        prop.type = "string";
        prop.format = "date";
        break;
      case "select":
        prop.type = "string";
        if (field.validation?.options) {
          prop.enum = field.validation.options;
        }
        break;
    }

    if (field.standardReference) {
      prop["x-standard-reference"] = field.standardReference;
    }

    properties[field.key] = prop;
    if (field.required) {
      required.push(field.key);
    }
  }

  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: schema.metadata.name,
    description: schema.metadata.description,
    type: "object",
    properties,
    required,
  };

  if (
    schema.metadata.appliedStandards &&
    schema.metadata.appliedStandards.length > 0
  ) {
    jsonSchema["x-applied-standards"] = schema.metadata.appliedStandards;
  }

  return jsonSchema;
}

/**
 * Exports a SerializedSchema to a FHIR R4 Questionnaire resource.
 * Only meaningful when the schema has FHIR-related standards applied.
 */
export function exportToFHIRQuestionnaire(
  schema: SerializedSchema,
  standardId?: string,
): object {
  const standard = standardId ? getStandardById(standardId) : undefined;

  const items = schema.fields.map((field, index) =>
    fieldToFHIRItem(field, index),
  );

  return {
    resourceType: "Questionnaire",
    id: slugify(schema.metadata.name),
    status: "draft",
    title: schema.metadata.name,
    description: schema.metadata.description,
    date: schema.updatedAt,
    ...(standard
      ? {
          url: `urn:questionnaire:${standard.id}`,
          version: standard.version,
          publisher: standard.name,
        }
      : {}),
    item: items,
  };
}

function fieldToFHIRItem(
  field: SchemaField,
  index: number,
): Record<string, unknown> {
  const item: Record<string, unknown> = {
    linkId: `${index + 1}`,
    text: field.label,
    type: mapToFHIRType(field.type),
    required: field.required,
  };

  if (field.description) {
    item._text = {
      extension: [
        {
          url: "http://hl7.org/fhir/StructureDefinition/rendering-markdown",
          valueMarkdown: field.description,
        },
      ],
    };
  }

  if (field.type === "select" && field.validation?.options) {
    item.answerOption = field.validation.options.map((opt) => ({
      valueCoding: {
        display: opt,
        code: slugify(opt),
      },
    }));
  }

  if (field.standardReference) {
    item.extension = [
      {
        url: "http://hl7.org/fhir/StructureDefinition/questionnaire-standardReference",
        valueString: field.standardReference,
      },
    ];
  }

  return item;
}

function mapToFHIRType(
  fieldType: SchemaField["type"],
): string {
  switch (fieldType) {
    case "string":
      return "string";
    case "email":
      return "string";
    case "number":
      return "decimal";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "select":
      return "choice";
    default:
      return "string";
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * Returns the available export formats for a schema based on its applied standards.
 */
export function getAvailableExportFormats(
  schema: SerializedSchema,
): { id: string; label: string }[] {
  const formats: { id: string; label: string }[] = [
    { id: "json-schema", label: "JSON Schema" },
  ];

  if (schema.metadata.appliedStandards) {
    for (const stdId of schema.metadata.appliedStandards) {
      const standard = getStandardById(stdId);
      if (standard?.exportFormats.includes("fhir-questionnaire-json")) {
        formats.push({
          id: "fhir-questionnaire-json",
          label: "FHIR Questionnaire (JSON)",
        });
        break;
      }
    }
  }

  return formats;
}

/**
 * Exports a schema in the specified format.
 * Returns a JSON string ready for download.
 */
export function exportSchema(
  schema: SerializedSchema,
  format: string,
): string {
  switch (format) {
    case "json-schema":
      return JSON.stringify(exportToJSONSchema(schema), null, 2);
    case "fhir-questionnaire-json": {
      const fhirStandardId = schema.metadata.appliedStandards?.find((id) => {
        const std = getStandardById(id);
        return std?.exportFormats.includes("fhir-questionnaire-json");
      });
      return JSON.stringify(
        exportToFHIRQuestionnaire(schema, fhirStandardId),
        null,
        2,
      );
    }
    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}
