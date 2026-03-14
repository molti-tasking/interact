"use client";

import { A2UISurface } from "@/components/a2ui/A2UISurface";
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
          <Link href="/forms">
            <Button variant="outline">
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Back to Forms
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const hasA2UIMessages =
    schema.a2uiMessages && schema.a2uiMessages.length > 0;

  return (
    <div className="space-y-12">
      <div className="space-y-4">
        <div>
          <Link href="/forms">
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
      </div>

      <ComponentWrapper
        title={schema.title}
        description="Fill out and submit this form, or modify its structure"
      >
        {hasA2UIMessages ? (
          <A2UISurface
            messages={schema.a2uiMessages!}
            className="rounded-lg border p-4"
          />
        ) : (
          <DynamicFormController slug={slug} />
        )}
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
