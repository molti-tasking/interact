"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SchemaProposal } from "@/lib/types";
import { Check, Pencil, X } from "lucide-react";

interface ProposalCardProps {
  proposal: SchemaProposal;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onModify?: (id: string) => void;
}

export function ProposalCard({
  proposal,
  onAccept,
  onReject,
  onModify,
}: ProposalCardProps) {
  const { diff } = proposal;
  const isPending = proposal.status === "pending";

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">{proposal.description}</p>
          <p className="text-xs text-muted-foreground">{proposal.rationale}</p>
        </div>
        {!isPending && (
          <Badge
            variant={proposal.status === "accepted" ? "default" : "secondary"}
          >
            {proposal.status}
          </Badge>
        )}
      </div>

      {/* Diff summary */}
      <div className="flex gap-2 text-xs">
        {diff.added.length > 0 && (
          <Badge variant="outline" className="text-green-600">
            +{diff.added.length} field{diff.added.length > 1 ? "s" : ""}
          </Badge>
        )}
        {diff.removed.length > 0 && (
          <Badge variant="outline" className="text-red-600">
            -{diff.removed.length} field{diff.removed.length > 1 ? "s" : ""}
          </Badge>
        )}
        {diff.modified.length > 0 && (
          <Badge variant="outline" className="text-yellow-600">
            ~{diff.modified.length} modified
          </Badge>
        )}
      </div>

      {/* Actions */}
      {isPending && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => onAccept(proposal.id)}
          >
            <Check className="h-3 w-3 mr-1" />
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReject(proposal.id)}
          >
            <X className="h-3 w-3 mr-1" />
            Reject
          </Button>
          {onModify && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onModify(proposal.id)}
            >
              <Pencil className="h-3 w-3 mr-1" />
              Modify
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
