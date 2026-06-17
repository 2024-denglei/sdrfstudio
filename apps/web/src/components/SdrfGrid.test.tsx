import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SdrfGrid } from "./SdrfGrid";
import type { SdrfTable } from "../types";

const table: SdrfTable = {
  id: "table-1",
  project_id: "project-1",
  headers: ["source name", "characteristics[organism]"],
  rows: [{ "source name": "sample-1", "characteristics[organism]": "Homo sapiens" }],
  column_metadata: {},
  dirty: false,
  validation_state: {},
};

describe("SdrfGrid", () => {
  afterEach(() => cleanup());

  it("lets users edit a cell and returns the updated table", async () => {
    const onTableChange = vi.fn();
    render(<SdrfGrid table={table} editable onTableChange={onTableChange} />);

    const input = screen.getByLabelText("Edit row 1, source name") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "sample-2");

    expect(onTableChange).toHaveBeenLastCalledWith({
      ...table,
      dirty: true,
      rows: [{ "source name": "sample-2", "characteristics[organism]": "Homo sapiens" }],
    });
  });

  it("does not rerender unchanged table rows when sibling form fields change", async () => {
    const valueToString = vi.fn(() => "sample-1");
    const stableTable = {
      ...table,
      rows: [{
        "source name": { toString: valueToString } as unknown as string,
        "characteristics[organism]": "Homo sapiens",
      }],
    };

    function Host() {
      const [value, setValue] = useState("");
      return (
        <>
          <input aria-label="Sibling field" value={value} onChange={(event) => setValue(event.target.value)} />
          <SdrfGrid table={stableTable} />
        </>
      );
    }

    render(<Host />);
    expect(valueToString).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText("Sibling field"), "abc");

    expect(valueToString).toHaveBeenCalledTimes(1);
  });

  it("can hide columns that have no filled values", () => {
    render(
      <SdrfGrid
        table={{
          ...table,
          headers: ["source name", "characteristics[organism]", "characteristics[disease]"],
          rows: [{ "source name": "sample-1", "characteristics[organism]": "", "characteristics[disease]": "normal" }],
        }}
        showFallback={false}
        onlyPopulatedColumns
      />,
    );

    expect(screen.getByRole("columnheader", { name: "source name" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "characteristics[disease]" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "characteristics[organism]" })).toBeNull();
  });

  it("shows the empty sample rows state when every available column is unfilled", () => {
    render(<SdrfGrid table={{ ...table, rows: [] }} showFallback={false} onlyPopulatedColumns />);

    expect(screen.getByText("No sample rows yet. Apply a manual or AI design to populate the table.")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "source name" })).toBeNull();
  });
});
