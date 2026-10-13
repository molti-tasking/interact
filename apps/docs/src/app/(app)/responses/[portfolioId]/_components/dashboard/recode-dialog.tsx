"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { planRecode, type RecodeOp } from "@/lib/engine/recode";
import {
  knownCategories,
  type CategoryBucket,
  type NumericOutlier,
} from "@/lib/engine/response-stats";
import type { ResponseRowLike } from "@/lib/form-renderer/response-rows";
import { formatValue } from "@/lib/form-renderer/values";
import type { Field, Portfolio } from "@/lib/types";
import { Loader2, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { plural } from "./chart-parts";

/** What the creator picked in a chart to recode. */
export type RecodeTarget =
  | { kind: "option"; field: Field; bucket: CategoryBucket; mode: "rename" | "merge" }
  | { kind: "unknown"; field: Field; bucket: CategoryBucket; mode: "map" | "add" | "clear" }
  | { kind: "number"; field: Field; outlier: NumericOutlier; mode: "fix" | "range" };

// ---------------------------------------------------------------------------
// Entry points in the charts
// ---------------------------------------------------------------------------

/** ⋮ menu at the end of a category's bar. */
export function BucketMenu({
  field,
  bucket,
  onPick,
}: {
  field: Field;
  bucket: CategoryBucket;
  onPick: (target: RecodeTarget) => void;
}) {
  const isSelect = field.type.kind === "select";
  const options = knownCategories(field);
  const items: { label: string; target: RecodeTarget }[] = bucket.known
    ? isSelect
      ? [
          { label: "Rename option…", target: { kind: "option", field, bucket, mode: "rename" } },
          ...(options.length > 1
            ? [{ label: "Merge into another option…", target: { kind: "option" as const, field, bucket, mode: "merge" as const } }]
            : []),
        ]
      : []
    : [
        ...(options.length > 0
          ? [{ label: "Map to an option…", target: { kind: "unknown" as const, field, bucket, mode: "map" as const } }]
          : []),
        ...(isSelect
          ? [{ label: "Add as an option", target: { kind: "unknown" as const, field, bucket, mode: "add" as const } }]
          : []),
        { label: "Clear these answers", target: { kind: "unknown", field, bucket, mode: "clear" } },
      ];
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 text-muted-foreground"
          aria-label={`Recode "${bucket.label}"`}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onSelect={() => onPick(item.target)}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// The dialog: choose, preview, apply
// ---------------------------------------------------------------------------

export function RecodeDialog({
  target,
  onClose,
  portfolio,
  rows,
  applying,
  onApply,
}: {
  target: RecodeTarget | null;
  onClose: () => void;
  portfolio: Portfolio;
  rows: readonly ResponseRowLike[];
  applying: boolean;
  onApply: (op: RecodeOp) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target && (
          <RecodeForm
            // Fresh state per target
            key={`${target.field.id}:${target.kind}:${"bucket" in target ? target.bucket.key : target.outlier.rowId}:${target.mode}`}
            target={target}
            portfolio={portfolio}
            rows={rows}
            applying={applying}
            onApply={onApply}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecodeForm({
  target,
  portfolio,
  rows,
  applying,
  onApply,
  onCancel,
}: {
  target: RecodeTarget;
  portfolio: Portfolio;
  rows: readonly ResponseRowLike[];
  applying: boolean;
  onApply: (op: RecodeOp) => void;
  onCancel: () => void;
}) {
  const { field } = target;
  const options = knownCategories(field);
  const [mode, setMode] = useState(target.mode);
  const [label, setLabel] = useState("bucket" in target ? target.bucket.label : "");
  const [into, setInto] = useState("");
  const [number, setNumber] = useState(
    target.kind === "number" ? String(target.outlier.value) : "",
  );
  const numberType = field.type.kind === "number" ? field.type : null;
  const [min, setMin] = useState(numberType?.min?.toString() ?? "");
  const [max, setMax] = useState(numberType?.max?.toString() ?? "");
  const [clearOutside, setClearOutside] = useState(true);

  const toNumber = (s: string) => (s.trim() === "" ? undefined : Number(s));
  let op: RecodeOp | null = null;
  let title = "";
  if (target.kind === "option") {
    const value = target.bucket.key;
    title = `"${target.bucket.label}" in ${field.label}`;
    op =
      mode === "rename"
        ? { kind: "renameOption", fieldId: field.id, value, label }
        : into
          ? { kind: "mergeOptions", fieldId: field.id, from: [value], into }
          : null;
  } else if (target.kind === "unknown") {
    const key = target.bucket.key;
    title = `"${target.bucket.label}" in ${field.label}`;
    op =
      mode === "add"
        ? { kind: "addAsOptions", fieldId: field.id, values: [key] }
        : mode === "clear"
          ? { kind: "mapValues", fieldId: field.id, map: { [key]: null } }
          : into
            ? { kind: "mapValues", fieldId: field.id, map: { [key]: into } }
            : null;
  } else {
    title = `${formatValue(target.outlier.value)} in ${field.label}`;
    if (mode === "range") {
      op = { kind: "setRange", fieldId: field.id, min: toNumber(min), max: toNumber(max), clearOutside };
    } else {
      const n = toNumber(number);
      op =
        n === undefined || Number.isFinite(n)
          ? { kind: "setValues", fieldId: field.id, values: { [target.outlier.rowId]: n ?? null } }
          : null;
    }
  }

  const plan = op ? planRecode(op, { schema: portfolio.schema, portfolio, rows }) : null;
  const canApply = !!plan && (plan.changes.length > 0 || !!plan.schemaChange);
  const show = (v: unknown) => formatValue(v, field) || "(empty)";

  const formEffect = (() => {
    if (!plan?.schemaChange || !op) return null;
    switch (op.kind) {
      case "renameOption":
        return "The form shows the new label; answers keep their stored value.";
      case "mergeOptions":
        return `The form no longer offers "${target.kind === "option" ? target.bucket.label : ""}".`;
      case "addAsOptions":
        return `The form offers "${op.values[0]}" from now on.`;
      case "setRange":
        return `The form accepts ${op.min ?? "any"} to ${op.max ?? "any"} from now on.`;
      default:
        return null;
    }
  })();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (op && canApply) onApply(op);
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle className="truncate">{title}</DialogTitle>
        <DialogDescription>
          Changes stored answers{target.kind !== "unknown" || mode === "add" ? " and the form" : ""} — you can undo it.
        </DialogDescription>
      </DialogHeader>

      {target.kind === "option" && (
        <ModeSwitch
          value={mode}
          onChange={(m) => setMode(m as typeof mode)}
          modes={[
            ["rename", "Rename"],
            ...(options.length > 1 ? [["merge", "Merge into…"] as [string, string]] : []),
          ]}
        />
      )}
      {target.kind === "unknown" && (
        <ModeSwitch
          value={mode}
          onChange={(m) => setMode(m as typeof mode)}
          modes={[
            ...(options.length ? [["map", "Map to option"] as [string, string]] : []),
            ...(field.type.kind === "select" ? [["add", "Add as option"] as [string, string]] : []),
            ["clear", "Clear"],
          ]}
        />
      )}
      {target.kind === "number" && (
        <ModeSwitch
          value={mode}
          onChange={(m) => setMode(m as typeof mode)}
          modes={[
            ["fix", "Fix this answer"],
            ...(numberType ? [["range", "Set allowed range"] as [string, string]] : []),
          ]}
        />
      )}

      {mode === "rename" && (
        <div className="space-y-1.5">
          <Label htmlFor="recode-label">New label</Label>
          <Input id="recode-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      )}
      {(mode === "merge" || mode === "map") && (
        <div className="space-y-1.5">
          <Label>{mode === "merge" ? "Merge into" : "Map to"}</Label>
          <Select value={into} onValueChange={setInto}>
            <SelectTrigger className="w-full" aria-label="Target option">
              <SelectValue placeholder="Choose an option…" />
            </SelectTrigger>
            <SelectContent>
              {options
                .filter((o) => !("bucket" in target) || o.key !== target.bucket.key)
                .map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {mode === "fix" && (
        <div className="space-y-1.5">
          <Label htmlFor="recode-number">Correct value (empty to clear)</Label>
          <Input
            id="recode-number"
            inputMode="decimal"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </div>
      )}
      {mode === "range" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="recode-min">Minimum</Label>
              <Input id="recode-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recode-max">Maximum</Label>
              <Input id="recode-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={clearOutside} onCheckedChange={(c) => setClearOutside(c === true)} />
            Clear answers outside the range
          </label>
        </div>
      )}

      <div
        data-testid="recode-preview"
        className="space-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs"
        aria-live="polite"
      >
        {!plan ? (
          <p className="text-muted-foreground">Choose how to recode to see what changes.</p>
        ) : (
          <>
            <p className="font-medium">
              {plan.changes.length
                ? `${plural(plan.changes.length, "response changes", "responses change")}`
                : "No stored answers change"}
            </p>
            {plan.changes.slice(0, 4).map((c) => (
              <p key={c.row.id} className="text-muted-foreground">
                {show(c.oldValue)} → <span className="text-foreground">{show(c.newValue)}</span>
              </p>
            ))}
            {plan.changes.length > 4 && (
              <p className="text-muted-foreground">+{plan.changes.length - 4} more</p>
            )}
            {formEffect && <p>{formEffect}</p>}
            {plan.skippedParent > 0 && (
              <p className="text-muted-foreground">
                {plural(plan.skippedParent, "response", "responses")} from the parent form stay as they are.
              </p>
            )}
          </>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canApply || applying} data-testid="apply-recode">
          {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Apply
        </Button>
      </DialogFooter>
    </form>
  );
}

function ModeSwitch({
  value,
  onChange,
  modes,
}: {
  value: string;
  onChange: (mode: string) => void;
  modes: [string, string][];
}) {
  if (modes.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="What to do" className="flex flex-wrap gap-1">
      {modes.map(([mode, label]) => (
        <Button
          key={mode}
          type="button"
          size="sm"
          role="radio"
          aria-checked={value === mode}
          variant={value === mode ? "secondary" : "ghost"}
          className="h-7 text-xs"
          onClick={() => onChange(mode)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
