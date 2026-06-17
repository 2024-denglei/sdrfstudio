import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useRef } from "react";
import type { SdrfTable } from "../types";

type SdrfGridProps = {
  table?: SdrfTable;
  showFallback?: boolean;
  editable?: boolean;
  onlyPopulatedColumns?: boolean;
  visibleHeaders?: string[];
  onTableChange?: (table: SdrfTable) => void;
};

function hasDisplayValue(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

export function getSdrfGridData(table?: SdrfTable, showFallback = true) {
  return table?.rows?.length ? table.rows : showFallback ? sampleRows : [];
}

export function getSdrfGridHeaders(table?: SdrfTable, showFallback = true, onlyPopulatedColumns = false, visibleHeaders?: string[]) {
  const data = getSdrfGridData(table, showFallback);
  const headers = table?.headers?.length ? table.headers : showFallback ? Object.keys(sampleRows[0]) : [];
  const headerSet = new Set(headers);
  const displayHeaders = visibleHeaders?.length
    ? visibleHeaders.filter((header) => headerSet.has(header) || data.some((row) => Object.prototype.hasOwnProperty.call(row, header)))
    : headers;
  if (!onlyPopulatedColumns) return displayHeaders;
  return displayHeaders.filter((header) => data.some((row) => hasDisplayValue(row[header])));
}

function SdrfGridComponent({ table, showFallback = true, editable = false, onlyPopulatedColumns = false, visibleHeaders, onTableChange }: SdrfGridProps) {
  const data = useMemo(() => getSdrfGridData(table, showFallback), [showFallback, table?.rows]);
  const headers = useMemo(
    () => getSdrfGridHeaders(table, showFallback, onlyPopulatedColumns, visibleHeaders),
    [onlyPopulatedColumns, showFallback, table?.headers, table?.rows, visibleHeaders],
  );
  const tableRef = useRef(table);
  const tablePropRef = useRef(table);
  if (tablePropRef.current !== table) {
    tablePropRef.current = table;
    tableRef.current = table;
  }
  const handleCellChange = useCallback(
    (rowIndex: number, header: string, value: string) => {
      const currentTable = tableRef.current;
      if (!currentTable || !onTableChange) return;
      const nextTable = {
        ...currentTable,
        dirty: true,
        rows: currentTable.rows.map((row, index) => (index === rowIndex ? { ...row, [header]: value } : row)),
      };
      tableRef.current = nextTable;
      onTableChange(nextTable);
    },
    [onTableChange],
  );
  const columns = useMemo(() => headers.map((header) => ({
    accessorKey: header,
    header,
    cell: (info: { getValue: () => unknown; row: { index: number } }) => {
      const value = String(info.getValue() ?? "");
      if (!editable || !tableRef.current) return value;
      return (
        <input
          aria-label={`Edit row ${info.row.index + 1}, ${header}`}
          className="data-grid-input"
          defaultValue={value}
          key={`${info.row.index}-${header}-${value}`}
          onChange={(event) => handleCellChange(info.row.index, header, event.target.value)}
        />
      );
    },
  })), [editable, handleCellChange, headers]);
  const instance = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  if (!headers.length) {
    return (
      <div className="grid-wrap">
        <div className="empty-table">No sample rows yet. Apply a manual or AI design to populate the table.</div>
      </div>
    );
  }
  return (
    <div className="grid-wrap">
      <table className="data-grid">
        <thead>
          {instance.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => <th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}
            </tr>
          ))}
        </thead>
        <tbody>
          {instance.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const SdrfGrid = memo(SdrfGridComponent);

const sampleRows = [
  {
    "source name": "CTRL_01",
    "characteristics[organism]": "Homo sapiens",
    "characteristics[organism part]": "liver",
    "characteristics[disease]": "normal",
    "assay name": "RUN_DIA_01",
    "comment[data file]": "CTRL_S01_R1_F1.raw",
  },
  {
    "source name": "DIS_01",
    "characteristics[organism]": "Homo sapiens",
    "characteristics[organism part]": "liver",
    "characteristics[disease]": "liver disease",
    "assay name": "RUN_DIA_02",
    "comment[data file]": "DIS_S01_R1_F1.raw",
  },
];
