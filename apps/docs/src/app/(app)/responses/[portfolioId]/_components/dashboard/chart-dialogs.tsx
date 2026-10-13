"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  kindsForField,
  newWidgetId,
  WIDGET_KIND_INFO,
} from "@/lib/engine/dashboard";
import type {
  DashboardWidget,
  DashboardWidgetKind,
  PortfolioSchema,
} from "@/lib/types";
import { Sparkles } from "lucide-react";
import { useState } from "react";

/**
 * "Ask AI to change this chart" (with `widget`) or "Add a chart" (without):
 * describe it in words — or, when adding, pick a field and chart type.
 */
export function ChartDialog({
  open,
  onOpenChange,
  widget,
  schema,
  onDescribe,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widget?: DashboardWidget;
  schema: PortfolioSchema;
  onDescribe: (instruction: string) => void;
  onPick?: (widget: DashboardWidget) => void;
}) {
  const [text, setText] = useState("");
  const chartable = schema.fields.filter((f) => kindsForField(f).length > 0);
  const [fieldId, setFieldId] = useState<string>("");
  const field = chartable.find((f) => f.id === fieldId);
  const kinds = field ? kindsForField(field) : [];
  const [kind, setKind] = useState<DashboardWidgetKind | "">("");
  const pickedKind = kind && kinds.includes(kind) ? kind : kinds[0];

  const close = () => {
    setText("");
    setFieldId("");
    setKind("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{widget ? `Change "${widget.title}"` : "Add a chart"}</DialogTitle>
          <DialogDescription>
            {widget
              ? "Say what to show instead, e.g. “split this by role” or “show it as counts”."
              : "Describe what you want to see — or pick a field below."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            onDescribe(text.trim());
            close();
          }}
          className="space-y-2"
        >
          <Textarea
            data-testid="chart-instruction"
            aria-label="What should the chart show?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              widget
                ? "e.g. Compare this between beginners and experienced users"
                : "e.g. How satisfied are first-time visitors?"
            }
            rows={3}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!text.trim()}>
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {widget ? "Change chart" : "Suggest chart"}
            </Button>
          </div>
        </form>

        {!widget && onPick && chartable.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">Or chart a field directly</p>
            <div className="grid grid-cols-2 gap-2">
              <Select value={fieldId} onValueChange={setFieldId}>
                <SelectTrigger aria-label="Field" className="w-full">
                  <SelectValue placeholder="Field…" />
                </SelectTrigger>
                <SelectContent>
                  {chartable.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={pickedKind ?? ""}
                onValueChange={(k) => setKind(k as DashboardWidgetKind)}
                disabled={!field}
              >
                <SelectTrigger aria-label="Chart type" className="w-full">
                  <SelectValue placeholder="Chart type…" />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {WIDGET_KIND_INFO[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                size="sm"
                variant="outline"
                disabled={!field || !pickedKind}
                onClick={() => {
                  if (!field || !pickedKind) return;
                  onPick({
                    id: newWidgetId(),
                    kind: pickedKind,
                    title: field.label,
                    fieldIds: [field.id],
                  });
                  close();
                }}
              >
                Add chart
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
