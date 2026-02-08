"use client";

import type { ParseRawDataResponse } from "@/app/actions/schema-actions";
import { parseRawDataForFormAction } from "@/app/actions/schema-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { SerializedSchema } from "@/lib/schema-manager";
import { FileTextIcon, LoaderIcon, MicIcon, UploadIcon } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

interface FillFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSchema: SerializedSchema;
  onDataParsed: (result: ParseRawDataResponse) => void;
}

export function FillFormDialog({
  open,
  onOpenChange,
  currentSchema,
  onDataParsed,
}: FillFormDialogProps) {
  const [activeTab, setActiveTab] = useState<"text" | "audio" | "file">("text");
  const [textData, setTextData] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isPending, startTransition] = useTransition();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleParse = async () => {
    let rawData = "";
    let dataSource: "text" | "audio" | "file" = "text";

    try {
      // Prepare data based on active tab
      if (activeTab === "text") {
        rawData = textData;
        dataSource = "text";
        if (!rawData.trim()) {
          toast.error("Please enter some text to parse");
          return;
        }
      } else if (activeTab === "audio") {
        if (!audioBlob) {
          toast.error("Please record audio first");
          return;
        }
        // For now, we'll use a placeholder. In production, you'd transcribe the audio
        // using an API like Whisper or Anthropic's audio capabilities
        toast.info(
          "Audio transcription not yet implemented. Please use text input.",
        );
        return;
      } else if (activeTab === "file") {
        if (!selectedFile) {
          toast.error("Please select a file");
          return;
        }
        // Read file content
        rawData = await selectedFile.text();
        dataSource = "file";
      }

      // Call the AI parsing action
      startTransition(async () => {
        const result = await parseRawDataForFormAction({
          currentSchema,
          rawData,
          dataSource,
        });

        if (result.success) {
          onDataParsed(result);
          onOpenChange(false);
          // Reset state
          setTextData("");
          setSelectedFile(null);
          setAudioBlob(null);
        } else {
          toast.error(result.error || "Failed to parse data");
        }
      });
    } catch (error) {
      console.error("Error parsing data:", error);
      toast.error("Failed to parse data");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fill Form with Data</DialogTitle>
          <DialogDescription>
            Upload or paste data to automatically fill the form. The AI will
            match fields and suggest schema changes if needed.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="text">
              <FileTextIcon className="h-4 w-4 mr-2" />
              Text
            </TabsTrigger>
            <TabsTrigger value="audio">
              <MicIcon className="h-4 w-4 mr-2" />
              Audio
            </TabsTrigger>
            <TabsTrigger value="file">
              <UploadIcon className="h-4 w-4 mr-2" />
              File
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="text-data">Paste your data</Label>
              <Textarea
                id="text-data"
                placeholder="You can paste text, JSON, CSV, or any data."
                value={textData}
                onChange={(e) => setTextData(e.target.value)}
                rows={8}
                className="font-mono text-sm"
              />
            </div>
          </TabsContent>

          <TabsContent value="audio" className="space-y-4">
            <div className="space-y-2">
              <Label>Record audio</Label>
              <p className="text-xs text-muted-foreground">
                Note: Audio transcription requires additional setup and is not
                yet implemented.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="file" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Upload a file</Label>
              <div
                className="flex items-center justify-center p-8 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="text-center">
                  {selectedFile ? (
                    <div>
                      <FileTextIcon className="h-8 w-8 mx-auto mb-2 text-green-600" />
                      <p className="text-sm font-medium">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  ) : (
                    <div>
                      <UploadIcon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm">Click to upload a file</p>
                      <p className="text-xs text-muted-foreground">
                        JSON, CSV, TXT, or any text file
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <Input
                ref={fileInputRef}
                id="file-upload"
                type="file"
                accept=".json,.csv,.txt,.text,.tex,.pdf"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleParse} disabled={isPending}>
            {isPending && <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />}
            Parse & Review
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
