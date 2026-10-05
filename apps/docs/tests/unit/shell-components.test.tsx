import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import Home from "@/app/(app)/page";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScrollFadeContainer } from "@/components/workspace/ScrollFadeContainer";

function Harness({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete it?"
        description="Gone for good."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
      />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("renders as an alert dialog and closes after a successful confirm", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<Harness onConfirm={onConfirm} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByText("Delete")));
    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("closed"));
  });

  it("stays open when the action fails", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("nope"));
    render(<Harness onConfirm={onConfirm} />);
    await act(async () => fireEvent.click(screen.getByText("Delete")));
    expect(screen.getByTestId("state").textContent).toBe("open");
    expect(screen.getByText("Delete")).not.toBeDisabled();
  });

  it("cancel closes without confirming", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("state").textContent).toBe("closed");
  });
});

describe("ScrollFadeContainer", () => {
  it("renders children without ResizeObserver support", () => {
    render(
      <ScrollFadeContainer>
        <p>item</p>
      </ScrollFadeContainer>,
    );
    expect(screen.getByText("item")).toBeInTheDocument();
  });
});

describe("Landing page", () => {
  it("shows the first how-it-works step by default and has no nested main", () => {
    const { container } = render(<Home />);
    expect(container.querySelector("main")).toBeNull();
    const firstStep = screen.getByRole("button", { name: /Express your intent/ });
    expect(firstStep).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Resolve design probes/ }));
    expect(firstStep).toHaveAttribute("aria-pressed", "false");
  });
});
