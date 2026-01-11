"use client";
import { initializeSerializedSchema, loadSchema } from "@/lib/schema-manager";
import { eventRegistrationMetadata } from "@/schemas/event-registration";
import { useQuery } from "@tanstack/react-query";

export const useSchema = () => {
  return useQuery({
    queryKey: ["schema"],
    queryFn: () => {
      const stored = loadSchema();
      if (stored) {
        return stored;
      }
      const initialSchema = initializeSerializedSchema(
        eventRegistrationMetadata
      );
      return initialSchema;
    },
  });
};
