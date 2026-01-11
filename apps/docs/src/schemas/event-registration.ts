import { z } from "zod";

export const eventRegistrationSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  eventDate: z.string().min(1, "Event date is required"),
  attendeeCount: z.coerce.number().min(1, "At least 1 attendee required"),
});

export type EventRegistration = z.infer<typeof eventRegistrationSchema>;

// Schema metadata for AI context
// TODO: Integrate this metadata with the original schema through zod meta fields
export const eventRegistrationMetadata = {
  name: "Event Registration Form",
  description: "A form for registering attendees for an event",
  fields: {
    name: {
      label: "Full Name",
      description: "Attendee's full name",
      type: "string" as const,
      required: true,
    },
    email: {
      label: "Email Address",
      description: "Contact email for event updates",
      type: "email" as const,
      required: true,
    },
    eventDate: {
      label: "Event Date",
      description: "The date of the event",
      type: "date" as const,
      required: true,
    },
    attendeeCount: {
      label: "Number of Attendees",
      description: "Total number of people attending",
      type: "number" as const,
      required: true,
      validation: {
        min: 1,
      },
    },
  },
};
