"use client";
import {
  initializeSerializedSchema,
  loadSchema,
  loadSchemas,
  saveSchema,
} from "@/lib/schema-manager";
import { eventRegistrationMetadata } from "@/schemas/event-registration";
import { useQuery } from "@tanstack/react-query";

export const useSchema = (slug?: string) => {
  return useQuery({
    queryKey: ["schema", slug],
    queryFn: () => {
      if (!slug) {
        // Return null if no slug provided
        return null;
      }

      const stored = loadSchema(slug);
      if (stored) {
        return stored;
      }

      // Initialize default schema if it doesn't exist
      if (slug === "event-registration") {
        const initialSchema = initializeSerializedSchema(
          eventRegistrationMetadata
        );
        saveSchema(initialSchema);
        return initialSchema;
      }

      return null;
    },
  });
};

export const useSchemas = () => {
  return useQuery({
    queryKey: ["schemas"],
    queryFn: () => {
      const schemas = loadSchemas();
      if (schemas && schemas.length > 0) {
        return schemas;
      }

      // Initialize with default event registration schema
      const initialSchema = initializeSerializedSchema(
        eventRegistrationMetadata
      );
      saveSchema(initialSchema);
      return [initialSchema];
    },
  });
};
