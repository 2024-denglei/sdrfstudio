import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SampleSelectionDialog } from "./SampleSelectionDialog";
import type { SampleRosterItem } from "../sampleBatch";

const samples: SampleRosterItem[] = [
  { id: "sample-1", sourceName: "sample_01" },
  { id: "sample-2", sourceName: "sample_02" },
  { id: "sample-3", sourceName: "sample_03" },
];

describe("SampleSelectionDialog", () => {
  afterEach(() => cleanup());

  it("filters samples and confirms explicit selections", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SampleSelectionDialog
        open
        title="Select samples (Disease)"
        samples={samples}
        selectedIds={["sample-1"]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Select samples (Disease)" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Search samples"), "02");

    expect(screen.queryByRole("checkbox", { name: "sample_01" })).toBeNull();
    const sampleTwo = screen.getByRole("checkbox", { name: "sample_02" }) as HTMLInputElement;
    expect(sampleTwo.checked).toBe(false);

    await userEvent.click(sampleTwo);
    await userEvent.click(screen.getByRole("button", { name: "Confirm samples" }));

    expect(onConfirm).toHaveBeenCalledWith(["sample-1", "sample-2"]);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("supports select all and clear all actions", async () => {
    const onConfirm = vi.fn();
    render(
      <SampleSelectionDialog
        open
        title="Select samples (Organism part)"
        samples={samples}
        selectedIds={["sample-1"]}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect((screen.getByRole("checkbox", { name: "sample_03" }) as HTMLInputElement).checked).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect((screen.getByRole("checkbox", { name: "sample_01" }) as HTMLInputElement).checked).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Confirm samples" }));

    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it("toggles samples when users click anywhere on the option row", async () => {
    render(
      <SampleSelectionDialog
        open
        title="Select samples (Organism)"
        samples={samples}
        selectedIds={[]}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    const firstOption = screen.getByText("sample_01").closest("label");
    expect(firstOption).toBeTruthy();

    await userEvent.click(firstOption as HTMLLabelElement);
    expect((screen.getByRole("checkbox", { name: "sample_01" }) as HTMLInputElement).checked).toBe(true);

    await userEvent.click(firstOption as HTMLLabelElement);
    expect((screen.getByRole("checkbox", { name: "sample_01" }) as HTMLInputElement).checked).toBe(false);
  });

  it("supports drag painting samples with the primary mouse button", async () => {
    const onConfirm = vi.fn();
    render(
      <SampleSelectionDialog
        open
        title="Select samples (Organism)"
        samples={samples}
        selectedIds={[]}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    );

    const firstOption = screen.getByText("sample_01").closest("label");
    const secondOption = screen.getByText("sample_02").closest("label");
    const thirdOption = screen.getByText("sample_03").closest("label");
    expect(firstOption).toBeTruthy();
    expect(secondOption).toBeTruthy();
    expect(thirdOption).toBeTruthy();

    fireEvent.mouseDown(firstOption as HTMLLabelElement, { button: 0, buttons: 1 });
    fireEvent.mouseEnter(secondOption as HTMLLabelElement, { buttons: 1 });
    fireEvent.mouseEnter(thirdOption as HTMLLabelElement, { buttons: 1 });
    fireEvent.mouseUp(thirdOption as HTMLLabelElement);

    expect((screen.getByRole("checkbox", { name: "sample_01" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "sample_02" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "sample_03" }) as HTMLInputElement).checked).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Confirm samples" }));

    expect(onConfirm).toHaveBeenCalledWith(["sample-1", "sample-2", "sample-3"]);
  });
});
