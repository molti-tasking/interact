"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getSchemaDescription } from "@/lib/form";
import { cn } from "@/lib/utils";
import { ArrowUpRight, InfoIcon } from "lucide-react";
import Link from "next/link";
import z from "zod";
import { ScrollArea } from "../ui/scroll-area";

interface SchemaPromptDialogProps {
  formSchema: ReturnType<typeof z.object>;
}

export function SchemaPromptDialog({ formSchema }: SchemaPromptDialogProps) {
  return (
    <Dialog>
      <DialogTrigger>
        <Button size={"icon"}>
          <InfoIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-4">
            <InfoIcon className={cn("h-5 w-5")} />

            <span>Schema Prompt</span>
          </DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground">
          Below is the auto generated schema prompt based on{" "}
          <Link
            className="text-blue-800"
            target="_blank"
            href={"https://zod.dev/"}
          >
            zod form schema meta information
            <ArrowUpRight className="inline size-3 -mt-2" />
          </Link>
          . It shall be usable for additional context about the schema when
          passing it to LLM completions.
        </p>
        <ScrollArea className="max-h-[70vh] border bg-purple-50 text-purple-900 rounded-md p-4 mt-4 max-w-2xl w-full">
          <pre>{getSchemaDescription(formSchema)}</pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
