import type {
  A2UIMessage,
  ComponentDefinition,
} from "@a2ui-sdk/types/0.9";
import type { SchemaField, SerializedSchema } from "./schema-manager";

/**
 * Converts A2UI component definitions back to a SerializedSchema.
 * Maps: TextField→string/email, CheckBox→boolean, ChoicePicker→select,
 *       DateTimeInput→date, Slider→number
 */
export function a2uiComponentsToSerializedSchema(
  components: ComponentDefinition[],
  metadata?: { name?: string; description?: string },
): SerializedSchema {
  const fields: SchemaField[] = [];

  for (const comp of components) {
    const field = componentToSchemaField(comp);
    if (field) fields.push(field);
  }

  const fieldsRecord: Record<string, Omit<SchemaField, "key">> = {};
  for (const f of fields) {
    const { key, ...rest } = f;
    fieldsRecord[key] = rest;
  }

  return {
    fields,
    metadata: {
      name: metadata?.name ?? "A2UI Form",
      description: metadata?.description ?? "",
      fields: fieldsRecord,
    },
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

function componentToSchemaField(
  comp: ComponentDefinition,
): SchemaField | null {
  const id = comp.id;

  switch (comp.component) {
    case "TextField": {
      const variant = comp.variant as string | undefined;
      const isEmail = variant === "email" || id.toLowerCase().includes("email");
      const isNumber = variant === "number";
      return {
        key: id,
        type: isNumber ? "number" : isEmail ? "email" : "string",
        label: resolveStaticString(comp.label) ?? id,
        description: resolveStaticString(comp.description),
        required: hasRequiredCheck(comp),
        validation: buildValidation(comp),
      };
    }

    case "CheckBox":
      return {
        key: id,
        type: "boolean",
        label: resolveStaticString(comp.label) ?? id,
        description: resolveStaticString(comp.description),
        required: hasRequiredCheck(comp),
      };

    case "ChoicePicker": {
      const options = (comp.options as Array<{ label: unknown; value: string }>) ?? [];
      return {
        key: id,
        type: "select",
        label: resolveStaticString(comp.label) ?? id,
        description: resolveStaticString(comp.description),
        required: hasRequiredCheck(comp),
        validation: {
          options: options.map((o) => resolveStaticString(o.value) ?? String(o.value)),
        },
      };
    }

    case "DateTimeInput":
      return {
        key: id,
        type: "date",
        label: resolveStaticString(comp.label) ?? id,
        description: resolveStaticString(comp.description),
        required: hasRequiredCheck(comp),
      };

    case "Slider":
      return {
        key: id,
        type: "number",
        label: resolveStaticString(comp.label) ?? id,
        description: resolveStaticString(comp.description),
        required: hasRequiredCheck(comp),
        validation: {
          min: typeof comp.min === "number" ? comp.min : undefined,
          max: typeof comp.max === "number" ? comp.max : undefined,
        },
      };

    default:
      // Skip layout/display components (Card, Column, Row, Text, Button, etc.)
      return null;
  }
}

/**
 * Converts a SerializedSchema into a sequence of A2UI messages
 * that will render the form when processed by an A2UI provider.
 */
export function serializedSchemaToA2UIMessages(
  schema: SerializedSchema,
  surfaceId: string = "form-preview",
): A2UIMessage[] {
  const messages: A2UIMessage[] = [];

  // 1. Create surface
  messages.push({
    createSurface: { surfaceId, catalogId: "standard" },
  });

  // 2. Build components
  const fieldComponents: ComponentDefinition[] = [];
  const childIds: string[] = [];

  for (const field of schema.fields) {
    const comp = schemaFieldToComponent(field, surfaceId);
    if (comp) {
      fieldComponents.push(comp);
      childIds.push(comp.id);
    }
  }

  // Add a root column that holds all fields
  const rootColumn: ComponentDefinition = {
    id: "root",
    component: "Column",
    children: childIds,
    align: "stretch" as const,
  };

  // Title text
  if (schema.metadata.name) {
    const titleComp: ComponentDefinition = {
      id: "form-title",
      component: "Text",
      text: schema.metadata.name,
      variant: "h2",
    };
    fieldComponents.push(titleComp);
    childIds.unshift("form-title");
  }

  messages.push({
    updateComponents: {
      surfaceId,
      components: [rootColumn, ...fieldComponents],
    },
  });

  // 3. Set default data model values
  const dataModel: Record<string, unknown> = {};
  for (const field of schema.fields) {
    if (field.type === "boolean") {
      dataModel[field.key] = false;
    } else if (field.type === "number") {
      dataModel[field.key] = field.validation?.min ?? 0;
    } else {
      dataModel[field.key] = "";
    }
  }

  messages.push({
    updateDataModel: { surfaceId, path: "/", value: dataModel },
  });

  return messages;
}

function schemaFieldToComponent(
  field: SchemaField,
  _surfaceId: string,
): ComponentDefinition | null {
  switch (field.type) {
    case "string":
      return {
        id: field.key,
        component: "TextField",
        label: field.label,
        value: { path: `/${field.key}` },
        variant: "shortText",
        ...(field.required ? { checks: [{ message: `${field.label} is required`, call: "required", args: { value: { path: `/${field.key}` } } }] } : {}),
      };

    case "email":
      return {
        id: field.key,
        component: "TextField",
        label: field.label,
        value: { path: `/${field.key}` },
        variant: "shortText",
        checks: [
          ...(field.required ? [{ message: `${field.label} is required`, call: "required", args: { value: { path: `/${field.key}` } } }] : []),
          { message: "Invalid email address", call: "email", args: { value: { path: `/${field.key}` } } },
        ],
      };

    case "number":
      if (field.validation?.min !== undefined && field.validation?.max !== undefined) {
        return {
          id: field.key,
          component: "Slider",
          label: field.label,
          min: field.validation.min,
          max: field.validation.max,
          value: { path: `/${field.key}` },
        };
      }
      return {
        id: field.key,
        component: "TextField",
        label: field.label,
        value: { path: `/${field.key}` },
        variant: "number",
      };

    case "boolean":
      return {
        id: field.key,
        component: "CheckBox",
        label: field.label,
        value: { path: `/${field.key}` },
      };

    case "date":
      return {
        id: field.key,
        component: "DateTimeInput",
        label: field.label,
        value: { path: `/${field.key}` },
        enableDate: true,
        enableTime: false,
      };

    case "select":
      return {
        id: field.key,
        component: "ChoicePicker",
        label: field.label,
        variant: "mutuallyExclusive",
        options: (field.validation?.options ?? []).map((opt) => ({
          label: opt,
          value: opt,
        })),
        value: { path: `/${field.key}` },
      };

    default:
      return null;
  }
}

/**
 * Converts parsed form values into a sequence of updateDataModel messages,
 * one per field, suitable for progressive fill animation.
 */
export function formValuesToDataModelMessages(
  values: Record<string, unknown>,
  surfaceId: string = "form-preview",
): A2UIMessage[] {
  return Object.entries(values).map(([key, value]) => ({
    updateDataModel: {
      surfaceId,
      path: `/${key}`,
      value,
    },
  }));
}

/**
 * Extracts form values from an A2UI data model.
 */
export function a2uiDataModelToFormValues(
  dataModel: Record<string, unknown>,
): Record<string, unknown> {
  // The data model is already a flat key-value store
  return { ...dataModel };
}

// -- Helpers --

function resolveStaticString(val: unknown): string | undefined {
  if (typeof val === "string") return val;
  return undefined;
}

function hasRequiredCheck(comp: ComponentDefinition): boolean {
  const checks = comp.checks as Array<{ call?: string }> | undefined;
  if (!checks) return false;
  return checks.some((c) => c.call === "required");
}

function buildValidation(
  comp: ComponentDefinition,
): SchemaField["validation"] | undefined {
  const checks = comp.checks as Array<{
    call?: string;
    args?: Record<string, unknown>;
  }> | undefined;
  if (!checks) return undefined;

  const validation: SchemaField["validation"] = {};
  for (const check of checks) {
    if (check.call === "length" && check.args) {
      if (typeof check.args.min === "number") validation.min = check.args.min;
      if (typeof check.args.max === "number") validation.max = check.args.max;
    }
    if (check.call === "regex" && check.args) {
      if (typeof check.args.pattern === "string")
        validation.pattern = check.args.pattern;
    }
  }
  return Object.keys(validation).length > 0 ? validation : undefined;
}
