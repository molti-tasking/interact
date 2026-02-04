"use client";

import { ComponentWrapper } from "@/components/ComponentWrapper";
import { DynamicFormController } from "@/components/form/DynamicFormController";
import { SubmissionsList } from "@/components/form/SubmissionsList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSchema } from "@/hooks/query/schemas";
import { ArrowLeftIcon, Loader } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function Page() {
  const params = useParams();
  const slug = params.slug as string;
  const { data: schema, isLoading } = useSchema(slug);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="text-muted-foreground">
            <Loader className="h-4 w-4 mr-2 inline-block" />
            Loading
          </div>
        </div>
      </div>
    );
  }
  if (!schema) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="text-muted-foreground">Form not found</div>
          <Link href="/malleable-form">
            <Button variant="outline">
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Back to Forms
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <div className="space-y-4">
        <div>
          <Link href="/malleable-form">
            <Button variant="ghost" size="sm">
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Back to Forms
            </Button>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-bold tracking-tight">{schema.title}</h1>
          <Badge variant="outline">v{schema.schema.version}</Badge>
        </div>
        <p className="text-lg text-muted-foreground max-w-3xl">
          {schema.schema.metadata.description}
        </p>
        <div className="text-sm text-muted-foreground space-y-1">
          <div>
            <strong>How to use this form:</strong>
          </div>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Fill out the form fields below</li>
            <li>
              Click the gear icon next to any field to modify its structure
            </li>
            <li>
              Use natural language to describe changes (e.g., &quot;add a
              dietary restrictions field&quot;)
            </li>
            <li>
              The AI will regenerate the schema with your requested changes
            </li>
            <li>Submit the form to save your entry</li>
            <li className="text-blue-400 font-black">
              TODO: What is a very impossible goal that we can somehow solve?
            </li>
            <li className="text-blue-400 font-black">
              TODO: What is the malleable intent? Who decides for changes?
            </li>
            <li className="text-blue-400 font-black">
              TODO: What about the end user programmability?
            </li>
            <li className="text-blue-400 font-black">
              TODO: Maybe we can record a meeting taking notes automatically
              into a form? Listening to a meeting in the team and let it create
              a list of all the projects we are working on.
            </li>
          </ul>
        </div>
      </div>

      <ComponentWrapper
        title={schema.title}
        description="Fill out and submit this form, or modify its structure"
      >
        <DynamicFormController slug={slug} />
      </ComponentWrapper>

      <ComponentWrapper
        title="Submissions"
        description={`All submissions for ${schema.title}`}
      >
        <SubmissionsList slug={slug} />
      </ComponentWrapper>
    </div>
  );
}
