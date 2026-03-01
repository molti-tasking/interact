"use server";

import type { SchemaMetadata, SerializedSchema } from "@/lib/schema-manager";
import { initializeSerializedSchema } from "@/lib/schema-manager";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

export interface SchemaModificationRequest {
  userPrompt: string;
}

export interface SchemaModificationResponse {
  success: boolean;

  result?: {
    artifactFormSchema: SerializedSchema;
    configuratorFormSchema: SerializedSchema;
    configuratorFormValues: Record<string, string | number | boolean>;
  };

  error?: string;
}

export async function regenerateFormSchemaAction(
  request: SchemaModificationRequest,
): Promise<SchemaModificationResponse> {
  try {
    const { userPrompt } = request;

    // Build the prompt for the LLM
    const systemPrompt = `You are a form schema generator that creates TWO related schemas:

1. **artifactFormSchema**: The actual form the user wants to create
2. **configuratorFormSchema**: A meta-form with clarifying questions about how to generate the artifact form
3. **configuratorFormValues**: Initial values for the configurator form (based on assumptions you make)

IMPORTANT RULES:
- Use valid field types: "string", "number", "boolean", "date", "email", "select"
- For select fields, ALWAYS include options in validation.options array
- Field keys MUST be camelCase and descriptive
- The configurator form should ask questions that help refine the artifact form
- Return ONLY valid JSON, no markdown or explanation

User request: ${userPrompt}

EXAMPLE OUTPUT STRUCTURE:
For a request like "I want a user registration form", you should generate:

{
  "artifactFormSchema": {
    "name": "User Registration",
    "description": "Form for new user registration",
    "fields": {
      "firstName": {
        "label": "First Name",
        "description": "User's first name",
        "type": "string",
        "required": true,
        "validation": { "min": 1, "max": 50 }
      },
      "email": {
        "label": "Email Address",
        "description": "User's email",
        "type": "email",
        "required": true
      }
    }
  },
  "configuratorFormSchema": {
    "name": "Registration Form Configuration",
    "description": "Configure the registration form behavior",
    "fields": {
      "includePhoneNumber": {
        "label": "Include Phone Number Field?",
        "description": "Add a phone number field to the form",
        "type": "boolean",
        "required": false
      },
      "requireEmailVerification": {
        "label": "Require Email Verification?",
        "description": "Send verification email after registration",
        "type": "boolean",
        "required": false
      },
      "passwordMinLength": {
        "label": "Minimum Password Length",
        "description": "Minimum characters for password",
        "type": "number",
        "required": false,
        "validation": { "min": 6, "max": 32 }
      }
    }
  },
  "configuratorFormValues": {
    "includePhoneNumber": true,
    "requireEmailVerification": true,
    "passwordMinLength": 8
  }
}

Return the complete response in this exact JSON format shown above.`;

    console.log("Generating form schemas");
    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt: systemPrompt,
      temperature: 0.3,
    });

    // Parse the LLM response
    let parsedResult: {
      artifactFormSchema: SchemaMetadata;
      configuratorFormSchema: SchemaMetadata;
      configuratorFormValues: Record<string, string | number | boolean>;
    };

    try {
      // Extract JSON from the response (in case there's markdown)
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }
      parsedResult = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("Failed to parse LLM response:", result.text);
      return {
        success: false,
        error: "Failed to parse schema from LLM response",
      };
    }

    // Validate the response structure
    if (
      !parsedResult.artifactFormSchema ||
      !parsedResult.configuratorFormSchema
    ) {
      return {
        success: false,
        error: "Invalid response: missing required schemas",
      };
    }

    if (
      !parsedResult.artifactFormSchema.fields ||
      !parsedResult.configuratorFormSchema.fields
    ) {
      return {
        success: false,
        error: "Invalid response: schemas missing fields",
      };
    }

    // Convert SchemaMetadata to SerializedSchema
    const artifactSchema = initializeSerializedSchema(
      parsedResult.artifactFormSchema,
    );
    const configuratorSchema = initializeSerializedSchema(
      parsedResult.configuratorFormSchema,
    );

    return {
      success: true,
      result: {
        artifactFormSchema: artifactSchema.schema,
        configuratorFormSchema: configuratorSchema.schema,
        configuratorFormValues: parsedResult.configuratorFormValues || {},
      },
    };
  } catch (error) {
    console.error("Schema generation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
