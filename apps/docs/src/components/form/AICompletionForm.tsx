"use client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { PartyPopperIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormSaveButton } from "../FormSaveButton";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FormCompleteDialog } from "./FormCompleteDialog";
import { SchemaPromptDialog } from "./SchemaPromptDialog";

const formSchema = z
  .object({
    title: z.string().min(1, "Title is required").meta({
      description: "Use this for AI gen",
    }),
    authors: z
      .array(
        z
          .object({
            name: z.string().min(1, "Name is required"),
            affiliation: z.string().min(1, "Affiliation is required"),
            secondaryAffiliation: z.string().optional(),
          })
          .meta({
            description: "This is an array of things.",
          })
      )
      .min(1, "At least one author is required")
      .meta({
        description: "asdasd",
        deprecated: false,
        id: "asda",
        title: "Asads",
      }),
    abstract: z.string().min(1, "Abstract is required"),
    keywords: z.string().min(1, "Keywords are required"),
    keywordArray: z.array(z.string().min(1, "Keywords are required")),
    paperSubmission: z.object({
      note: z.string().optional(),
      fileName: z.string().optional(),
    }),
    supplementalMaterials: z
      .array(
        z.object({
          note: z.string().optional(),
          fileName: z.string().optional(),
        })
      )
      .optional(),
  })
  .meta({
    description:
      "This is overall meta descriptino, but we want to have also the single fields metas",
  });

type FormValues = z.infer<typeof formSchema>;

export const AICompletionForm = () => {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "Ditch the chat",
      authors: [
        {
          name: "Niklas Elmqvist",
          affiliation: "Aarhus University, Aarhus, Denmark",
          secondaryAffiliation: "",
        },
      ],
      abstract: "",
      keywords: "",
      paperSubmission: { note: "", fileName: "" },
      supplementalMaterials: [{ note: "", fileName: "" }],
    },
  });

  const {
    fields: authorFields,
    append: appendAuthor,
    remove: removeAuthor,
  } = useFieldArray({
    control: form.control,
    name: "authors",
  });

  const {
    fields: supplementalFields,
    append: appendSupplemental,
    remove: removeSupplemental,
  } = useFieldArray({
    control: form.control,
    name: "supplementalMaterials",
  });

  const onSubmit = async (data: FormValues) => {
    try {
      console.log("Form data:", data);
      toast.success("Paper submission saved successfully");
    } catch (error) {
      toast.error("Unexpected error occurred: " + String(error));
    }
  };

  return (
    <Card className="relative">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex flex-row gap-2 items-center">
            <PartyPopperIcon /> Paper Submission
          </CardTitle>
          <div className="flex flex-row gap-2 items-center">
            <FormCompleteDialog onConfirm={console.log} />
            <SchemaPromptDialog formSchema={formSchema} />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter paper title" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Authors */}
            <div className="space-y-4">
              <FormLabel>Authors</FormLabel>
              {authorFields.map((field, index) => (
                <div key={field.id} className="space-y-3 rounded-lg border p-4">
                  <FormField
                    control={form.control}
                    name={`authors.${index}.name`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Author name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`authors.${index}.affiliation`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Affiliation</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="University, City, Country, email"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`authors.${index}.secondaryAffiliation`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secondary Affiliation (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Secondary affiliation if any"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {authorFields.length > 1 && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => removeAuthor(index)}
                    >
                      Remove Author
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  appendAuthor({
                    name: "",
                    affiliation: "",
                    secondaryAffiliation: "",
                  })
                }
              >
                <PlusIcon />
                Add Author
              </Button>
            </div>

            {/* Abstract */}
            <FormField
              control={form.control}
              name="abstract"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Abstract</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter paper abstract..."
                      rows={6}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Keywords */}
            <FormField
              control={form.control}
              name="keywords"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Keywords</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter keywords separated by commas"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Paper Submission */}
            <div className="space-y-4">
              <FormLabel>Paper Submission</FormLabel>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name={`paperSubmission.note`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Note</FormLabel>
                      <FormControl>
                        <Input placeholder="Add a note" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`paperSubmission.fileName`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Your File</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input
                            type="file"
                            accept=".pdf,.doc,.docx"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                field.onChange(file.name);
                              }
                            }}
                          />
                          {field.value && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => field.onChange("")}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Supplemental Material */}
            <div className="space-y-4">
              <FormLabel>Supplemental Material (Optional)</FormLabel>
              {supplementalFields?.map((field, index) => (
                <div
                  key={field.id}
                  className="flex flex-col gap-4 items-end w-full"
                >
                  <div className="grid grid-cols-2 gap-4 flex-1 w-full">
                    <FormField
                      control={form.control}
                      name={`supplementalMaterials.${index}.note`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Note</FormLabel>
                          <FormControl>
                            <Input placeholder="Add a note" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`supplementalMaterials.${index}.fileName`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Your File</FormLabel>
                          <FormControl>
                            <div className="flex items-center gap-2">
                              <Input
                                type="file"
                                accept=".zip,.pdf,.mp4,.mov"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    field.onChange(file.name);
                                  }
                                }}
                              />
                              {field.value && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => field.onChange("")}
                                >
                                  Delete
                                </Button>
                              )}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructiveSoft"
                    onClick={() => removeSupplemental(index)}
                  >
                    <TrashIcon /> Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => appendSupplemental({ note: "", fileName: "" })}
              >
                <PlusIcon />
                Add New File
              </Button>
            </div>

            <div className="flex justify-end">
              <FormSaveButton />
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};
