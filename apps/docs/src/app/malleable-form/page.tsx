"use client";

import { ComponentWrapper } from "@/components/ComponentWrapper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSchemas } from "@/hooks/query/schemas";
import { FileTextIcon, PlusIcon } from "lucide-react";
import Link from "next/link";

export default function Page() {
  const { data: schemas } = useSchemas();

  return (
    <div className="space-y-12">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-bold tracking-tight">Malleable Forms</h1>
        </div>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Dynamic forms that adapt to your needs. Create forms that evolve based
          on AI-powered schema modifications. Each form can have its own
          structure and collect its own submissions.
        </p>
        <div className="text-sm text-muted-foreground space-y-1">
          <div>
            <strong>How it works:</strong>
          </div>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Create multiple forms with different schemas</li>
            <li>Modify form structure using natural language</li>
            <li>Click the gear icon next to any field to modify it</li>
            <li>Add new fields or change existing ones with AI assistance</li>
            <li>Each form stores its own submissions independently</li>
            <li>All data is stored in localStorage for this demo</li>
          </ul>
        </div>
      </div>

      <ComponentWrapper
        title="Your Forms"
        description="Manage and create dynamic forms"
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {schemas?.length || 0} form{schemas?.length === 1 ? "" : "s"}
            </div>
            <Button size="sm" asChild>
              <Link href={"/malleable-form/create"}>
                <PlusIcon className="h-4 w-4 mr-2" />
                Create New Form
              </Link>
            </Button>
          </div>

          {schemas && schemas.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {schemas.map((schema) => (
                <Link key={schema.slug} href={`/malleable-form/${schema.slug}`}>
                  <Card className="cursor-pointer hover:border-primary transition-colors">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <FileTextIcon className="h-5 w-5 text-muted-foreground" />
                        <Badge variant="outline">
                          v{schema.schema.version}
                        </Badge>
                      </div>
                      <CardTitle className="text-lg mt-2">
                        {schema.title}
                      </CardTitle>
                      <CardDescription>
                        {schema.schema.metadata.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="text-sm text-muted-foreground">
                        {schema.schema.fields.length} field
                        {schema.schema.fields.length === 1 ? "" : "s"}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No forms yet. The default event registration form will be created
              automatically when you visit it.
            </div>
          )}
        </div>
      </ComponentWrapper>
    </div>
  );
}
