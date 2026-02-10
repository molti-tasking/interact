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
    console.log("Schema generatoin.");
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

    console.log("Generate text");
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

export interface SchemaGenerationFromRawDataRequest {
  formName: string;
  formDescription: string;
  rawData: string;
}

export interface SchemaGenerationFromRawDataResponse {
  success: boolean;
  schema?: SerializedSchema;
  error?: string;
}

export async function generateSchemaFromRawDataAction(
  request: SchemaGenerationFromRawDataRequest,
): Promise<SchemaGenerationFromRawDataResponse> {
  try {
    const { formName, formDescription, rawData } = request;

    if (!rawData.trim()) {
      return {
        success: false,
        error: "Raw data is required",
      };
    }

    // Build the prompt for the LLM
    const systemPrompt = `You are a form schema generator. Your task is to analyze raw data and generate an appropriate form schema.

IMPORTANT RULES:
1. Analyze the raw data to identify distinct data fields
2. Infer appropriate field types: "string", "number", "boolean", "date", "email", "select"
3. For repeating patterns or categorical data, use select fields with options
4. All field keys must be camelCase and descriptive
5. Mark fields as required if they appear consistently in the data
6. Include helpful descriptions based on the data patterns
7. Create at least 3-5 meaningful fields from the data
8. Return ONLY valid JSON, no markdown or explanation

Raw Data to Analyze:
${rawData}

Form Context:
Name: ${formName}
Description: ${formDescription}

Based on this raw data, generate a schema that would collect similar information. Identify patterns, field types, and structure from the provided data.

Return the complete schema in this exact JSON format:
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
    "name": "${formName}",
    "description": "${formDescription}",
    "fields": {
      "fieldName": {
        "label": "Display Label",
        "description": "Description",
        "type": "string",
        "required": true
      }
    }
  },
  "version": 1,
  "updatedAt": "${new Date().toISOString()}"
}`;

    console.log("Generating schema from raw data");
    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt: systemPrompt,
      temperature: 0.3,
    });

    // Parse the LLM response
    let schema: SerializedSchema;
    try {
      // Extract JSON from the response (in case there's markdown)
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }
      schema = JSON.parse(jsonMatch[0]) as SerializedSchema;
    } catch {
      console.error("Failed to parse LLM response:", result.text);
      return {
        success: false,
        error: "Failed to parse schema from LLM response",
      };
    }

    // Validate the generated schema
    if (!schema.fields || !Array.isArray(schema.fields)) {
      return {
        success: false,
        error: "Invalid schema: missing or invalid fields array",
      };
    }

    if (schema.fields.length === 0) {
      return {
        success: false,
        error: "Generated schema has no fields",
      };
    }

    // Ensure metadata matches the request
    if (!schema.metadata) {
      schema.metadata = {
        name: formName,
        description: formDescription,
        fields: {},
      };
    }

    // Ensure version is set
    if (!schema.version) {
      schema.version = 1;
    }

    // Ensure updatedAt is set
    if (!schema.updatedAt) {
      schema.updatedAt = new Date().toISOString();
    }

    return { success: true, schema };
  } catch (error) {
    console.error("Schema generation from raw data error:", error);
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

    console.log("Generate MigrationSuggestionAction");

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

export interface ParseRawDataRequest {
  currentSchema: SerializedSchema;
  rawData: string;
  dataSource: "text" | "audio" | "file";
}

export interface ExtraField {
  key: string;
  value: unknown;
  suggestedType: string;
  label: string;
  description?: string;
}

export interface FieldMismatch {
  field: string;
  expectedType: string;
  receivedValue: unknown;
  suggestion: string;
}

export interface ParseRawDataResponse {
  success: boolean;
  parsedData: Record<string, unknown>;
  extraFields: ExtraField[];
  mismatches: FieldMismatch[];
  fieldExplanations: Record<string, string>;
  schemaSuggestion?: SerializedSchema;
  error?: string;
}

export async function parseRawDataForFormAction(
  request: ParseRawDataRequest,
): Promise<ParseRawDataResponse> {
  try {
    const { currentSchema, rawData, dataSource } = request;

    if (!rawData.trim()) {
      return {
        success: false,
        parsedData: {},
        extraFields: [],
        mismatches: [],
        fieldExplanations: {},
        error: "Raw data is required",
      };
    }

    // Build the prompt for the LLM
    const systemPrompt = `You are a data parsing assistant. Your task is to parse raw data and match it to an existing form schema.

Current Form Schema:
${JSON.stringify(currentSchema, null, 2)}

Raw Data to Parse (source: ${dataSource}):
${rawData}

IMPORTANT INSTRUCTIONS:
1. Extract values from the raw data that match the existing schema fields
2. Identify any extra information in the raw data that doesn't match existing fields
3. Detect type mismatches where the data doesn't fit the expected field type
4. For extra fields, suggest appropriate field types and labels
5. If extra fields are found, generate an updated schema that includes them
6. For EACH field in parsedData, provide a brief explanation of why this value was chosen

Return ONLY valid JSON in this exact format:
{
  "parsedData": {
    "existingFieldKey1": "extracted value",
    "existingFieldKey2": "extracted value"
  },
  "fieldExplanations": {
    "existingFieldKey1": "Brief explanation of why this value was chosen from the raw data",
    "existingFieldKey2": "Another explanation"
  },
  "extraFields": [
    {
      "key": "newFieldKey",
      "value": "extracted value",
      "suggestedType": "string|number|boolean|date|email|select",
      "label": "Display Label",
      "description": "Optional description"
    }
  ],
  "mismatches": [
    {
      "field": "fieldKey",
      "expectedType": "number",
      "receivedValue": "not a number",
      "suggestion": "Convert to number or change field type to string"
    }
  ],
  "schemaSuggestion": {
    "fields": [...],
    "metadata": {...},
    "version": ${currentSchema.version + 1},
    "updatedAt": "${new Date().toISOString()}"
  }
}

RULES:
- Only include fields in parsedData that exist in the current schema
- Use camelCase for extra field keys
- If no extra fields found, return empty array for extraFields
- If no mismatches found, return empty array for mismatches
- Only include schemaSuggestion if extraFields exist
- The schemaSuggestion should be the complete updated schema with all fields (existing + new)
- Include fieldExplanations for every field in parsedData`;

    console.log("Parsing raw data for form filling");
    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt: systemPrompt,
      temperature: 0.3,
    });

    // Parse the LLM response
    let response: {
      parsedData: Record<string, unknown>;
      fieldExplanations?: Record<string, string>;
      extraFields: ExtraField[];
      mismatches: FieldMismatch[];
      schemaSuggestion?: SerializedSchema;
    };

    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }
      response = JSON.parse(jsonMatch[0]) as typeof response;
    } catch {
      console.error("Failed to parse LLM response:", result.text);
      return {
        success: false,
        parsedData: {},
        extraFields: [],
        mismatches: [],
        fieldExplanations: {},
        error: "Failed to parse AI response",
      };
    }

    return {
      success: true,
      parsedData: response.parsedData || {},
      extraFields: response.extraFields || [],
      mismatches: response.mismatches || [],
      fieldExplanations: response.fieldExplanations || {},
      schemaSuggestion: response.schemaSuggestion,
    };
  } catch (error) {
    console.error("Parse raw data error:", error);
    return {
      success: false,
      parsedData: {},
      extraFields: [],
      mismatches: [],
      fieldExplanations: {},
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
