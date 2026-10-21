"use client";

import { PublishedFormView } from "@/components/form/PublishedFormView";
import { useParams } from "next/navigation";

export default function PublishedFormPage() {
  const { id } = useParams<{ id: string }>();
  return <PublishedFormView formId={id} />;
}
