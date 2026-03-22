"use client";

import type { Field } from "@/lib/types";
import type { ReactElement } from "react";
import type { Control, ControllerRenderProps } from "react-hook-form";
import { BooleanField } from "./BooleanField";
import { DateField } from "./DateField";
import { FileField } from "./FileField";
import { GroupField } from "./GroupField";
import { NumberField } from "./NumberField";
import { ScaleField } from "./ScaleField";
import { SelectField } from "./SelectField";
import { TextField } from "./TextField";

export function renderFieldComponent(
  field: Field,
  formField: ControllerRenderProps,
  control: Control,
): ReactElement {
  switch (field.type.kind) {
    case "text":
      return <TextField field={field} formField={formField} />;
    case "number":
      return <NumberField field={field} formField={formField} />;
    case "select":
      return <SelectField field={field} formField={formField} />;
    case "date":
      return <DateField field={field} formField={formField} />;
    case "boolean":
      return <BooleanField field={field} formField={formField} />;
    case "file":
      return <FileField field={field} formField={formField} />;
    case "scale":
      return <ScaleField field={field} formField={formField} />;
    case "group":
      return <GroupField field={field} control={control} />;
    default:
      return <TextField field={field} formField={formField} />;
  }
}
