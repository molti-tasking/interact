"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OpinionInteraction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface OpinionCardResolvedDialogProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  resolvedOpinions: OpinionInteraction[];
}

export const OpinionCardResolvedDialog = ({
  dialogOpen,
  setDialogOpen,
  resolvedOpinions,
}: OpinionCardResolvedDialogProps) => {
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Resolved Decisions ({resolvedOpinions.length})
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          {resolvedOpinions.map((o) => {
            const selectedLabel =
              o.options.find((opt) => opt.value === o.selectedOption)?.label ??
              o.selectedOption;
            return (
              <Card key={o.id}>
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-sm font-medium">
                    {o.text}
                  </CardTitle>
                  <div className="flex gap-1.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] w-fit",
                        o.layer === "intent"
                          ? "text-blue-600 border-blue-200"
                          : o.layer === "dimensions"
                            ? "text-violet-600 border-violet-200"
                            : "text-amber-600 border-amber-200",
                      )}
                    >
                      {o.layer}
                    </Badge>
                    {o.dimensionName && (
                      <Badge variant="outline" className="text-[10px] w-fit">
                        {o.dimensionName}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center gap-2 text-sm bg-green-50 rounded-md px-3 py-2">
                    <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    <span className="font-medium text-green-800">
                      {selectedLabel}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
