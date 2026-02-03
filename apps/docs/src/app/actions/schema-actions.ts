"use server";

import type { SerializedSchema } from "@/lib/schema-manager";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

export interface SchemaModificationRequest {
  currentSchema: SerializedSchema;
  fieldContext: string;
  userPrompt: string;
}

export interface SchemaModificationResponse {
  success: boolean;
  newSchema?: SerializedSchema;
  error?: string;
}

export async function regenerateSchemaAction(
  request: SchemaModificationRequest,
): Promise<SchemaModificationResponse> {
  try {
    const { currentSchema, fieldContext, userPrompt } = request;

    // Build the prompt for the LLM
    const systemPrompt = `You are a form schema generator. Your task is to modify a form schema based on user requests.

IMPORTANT RULES:
1. Only modify ONE field at a time (either add one new field or modify one existing field)
2. Preserve all other fields exactly as they are
3. Return the COMPLETE schema with all fields
4. Use valid field types: "string", "number", "boolean", "date", "email", "select"
5. For select fields, include options in validation.options array
6. Ensure field keys are camelCase and descriptive
7. Return ONLY valid JSON, no markdown or explanation

Current schema:
${JSON.stringify(currentSchema, null, 2)}

User wants to modify field: ${
      fieldContext === "new" ? "Add a new field" : fieldContext
    }
User request: ${userPrompt}

Return the complete updated schema in this exact JSON format:
{
  "fields": [
    {
      "key": "fieldName",
      "type": "string|number|boolean|date|email|select",
      "label": "Display Label",
      "description": "Optional description",
      "required": true,
      "validation": {
        "min": 1,
        "max": 100,
        "options": ["option1", "option2"]
      }
    }
  ],
  "metadata": {
    "name": "Form Name",
    "description": "Form description",
    "fields": {
      "fieldName": {
        "label": "Display Label",
        "description": "Description",
        "type": "string",
        "required": true
      }
    }
  },
  "version": ${currentSchema.version + 1},
  "updatedAt": "${new Date().toISOString()}"
}`;

    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt: systemPrompt,
      temperature: 0.3,
      // TODO at this point I would like the llm to check all the existing submissions if a schema is valid. We can just call the validateNewSchemaWithPreviousSubmissions function in order to check that. If there is an invalid entry, we have 2 options:
      // 1. Create a updated schema version that matches the entries data
      // 2. Update the mismatching entry (or suggest an edit for all mismatching entries) in a certain standardized format, which shall be suggested to the user, that they can accept those edits.
    });

    // Parse the LLM response
    let newSchema: SerializedSchema;
    try {
      // Extract JSON from the response (in case there's markdown)
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }
      newSchema = JSON.parse(jsonMatch[0]) as SerializedSchema;
    } catch {
      console.error("Failed to parse LLM response:", result.text);
      return {
        success: false,
        error: "Failed to parse schema from LLM response",
      };
    }

    // Validate the new schema
    if (!newSchema.fields || !Array.isArray(newSchema.fields)) {
      return {
        success: false,
        error: "Invalid schema: missing or invalid fields array",
      };
    }

    // Check that only one field was changed
    const oldFieldKeys = new Set(currentSchema.fields.map((f) => f.key));
    const newFieldKeys = new Set(newSchema.fields.map((f) => f.key));

    const addedFields = newSchema.fields.filter(
      (f) => !oldFieldKeys.has(f.key),
    );
    const removedFields = currentSchema.fields.filter(
      (f) => !newFieldKeys.has(f.key),
    );
    const modifiedFields = newSchema.fields.filter((newField) => {
      const oldField = currentSchema.fields.find((f) => f.key === newField.key);
      return oldField && JSON.stringify(oldField) !== JSON.stringify(newField);
    });

    const totalChanges =
      addedFields.length + removedFields.length + modifiedFields.length;

    if (totalChanges !== 1) {
      console.warn(`Expected 1 change but got ${totalChanges}:`, {
        addedFields,
        removedFields,
        modifiedFields,
      });
      // We'll allow it but log a warning
    }

    return { success: true, newSchema };
  } catch (error) {
    console.error("Schema generation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export interface MigrationRequest {
  oldSchema: SerializedSchema;
  newSchema: SerializedSchema;
  existingData: Record<string, unknown>;
  affectedField: string;
}

export interface MigrationSuggestion {
  field: string;
  strategy: string;
  suggestedValue?: unknown;
  explanation: string;
}

export async function getMigrationSuggestionAction(
  request: MigrationRequest,
): Promise<MigrationSuggestion | null> {
  try {
    const { oldSchema, newSchema, existingData, affectedField } = request;

    const oldField = oldSchema.fields.find((f) => f.key === affectedField);
    const newField = newSchema.fields.find((f) => f.key === affectedField);

    if (!oldField && !newField) {
      return null;
    }

    const currentValue = existingData[affectedField];

    const systemPrompt = `You are a data migration assistant. A form field has been modified and you need to suggest how to migrate the existing data.

Old Field: ${oldField ? JSON.stringify(oldField, null, 2) : "N/A (new field)"}
New Field: ${
      newField ? JSON.stringify(newField, null, 2) : "N/A (field removed)"
    }
Current Value: ${JSON.stringify(currentValue)}

Provide a migration strategy. Consider:
1. If the field type changed, can the value be converted?
2. If validation rules changed, is the current value still valid?
3. If the field is new, what's a sensible default?
4. If the field was removed, should the user be warned about data loss?

Return ONLY valid JSON in this format:
{
  "field": "${affectedField}",
  "strategy": "convert|keep|clear|default|remove",
  "suggestedValue": <new value or null>,
  "explanation": "Brief explanation of the strategy"
}

Strategies:
- "convert": Transform the existing value to fit the new type
- "keep": Keep the existing value as-is (it's compatible)
- "clear": Clear the value (incompatible, user must re-enter)
- "default": Set a default value for a new field
- "remove": Field was removed, data will be lost`;

    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt: systemPrompt,
      temperature: 0.3,
    });

    // Parse the LLM response
    let suggestion: MigrationSuggestion;
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }
      suggestion = JSON.parse(jsonMatch[0]) as MigrationSuggestion;
    } catch {
      console.error("Failed to parse LLM response:", result.text);
      return null;
    }

    return suggestion;
  } catch (error) {
    console.error("Migration suggestion error:", error);
    return null;
  }
}
