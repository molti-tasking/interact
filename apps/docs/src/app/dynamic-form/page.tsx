import { ComponentWrapper } from "@/components/ComponentWrapper";
import { DynamicFormController } from "@/components/form/DynamicFormController";
import { SubmissionsList } from "@/components/form/SubmissionsList";

export default function Page() {
  return (
    <div className="space-y-12">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-bold tracking-tight">Malleable Form</h1>
        </div>
        <p className="text-lg text-muted-foreground max-w-3xl">
          A dynamic form that adapts to your needs. Click the settings icon next
          to any field to modify it, or add new fields as needed. The AI will
          regenerate the schema based on your natural language requests.
        </p>
        <div className="text-sm text-muted-foreground space-y-1">
          <div>
            <strong>How it works:</strong>
          </div>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Fill out the form normally or modify its structure</li>
            <li>Click the gear icon next to a field to modify it</li>
            <li>
              Use natural language to describe changes (e.g., &quot;add a
              dietary restrictions field&quot;)
            </li>
            <li>The AI regenerates the schema with your requested changes</li>
            <li>
              If your existing data conflicts with the new schema, you&apos;ll
              be prompted to migrate it
            </li>
            <li>All data is stored in localStorage for this demo</li>
          </ul>
        </div>
      </div>

      <ComponentWrapper
        title="Event Registration Form"
        description="A malleable form that evolves based on AI-powered schema modifications."
      >
        <DynamicFormController />
      </ComponentWrapper>

      <ComponentWrapper
        title="Submissions"
        description="All submitted event registrations."
      >
        <SubmissionsList />
      </ComponentWrapper>
    </div>
  );
}
