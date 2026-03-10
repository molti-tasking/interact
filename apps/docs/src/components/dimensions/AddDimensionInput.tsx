"use client";

import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { useState } from "react";

interface AddDimensionInputProps {
  onAdd: (name: string) => void;
}

export function AddDimensionInput({ onAdd }: AddDimensionInputProps) {
  const [value, setValue] = useState("");

  function handleSubmit() {
    const trimmed = value.trim();
    if (trimmed) {
      onAdd(trimmed);
      setValue("");
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed p-2">
      <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Add your own dimension..."
        className="h-6 border-0 p-0 text-xs shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
