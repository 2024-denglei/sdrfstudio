import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { SampleRosterItem } from "../sampleBatch";

type SampleSelectionDialogProps = {
  open: boolean;
  title: string;
  samples: SampleRosterItem[];
  selectedIds: string[];
  onConfirm: (ids: string[]) => void;
  onCancel: () => void;
};

export function SampleSelectionDialog({
  open,
  title,
  samples,
  selectedIds,
  onConfirm,
  onCancel,
}: SampleSelectionDialogProps) {
  const [query, setQuery] = useState("");
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const [dragMode, setDragMode] = useState<"select" | "deselect" | null>(null);
  const handledPointerDownRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setDraftIds(selectedIds);
    setQuery("");
    setDragMode(null);
  }, [open, selectedIds]);
  useEffect(() => {
    if (!dragMode) return undefined;
    const stopDragging = () => setDragMode(null);
    window.addEventListener("mouseup", stopDragging);
    return () => window.removeEventListener("mouseup", stopDragging);
  }, [dragMode]);

  const selectedSet = useMemo(() => new Set(draftIds), [draftIds]);
  const filteredSamples = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return samples;
    return samples.filter((sample) => sample.sourceName.toLowerCase().includes(normalizedQuery));
  }, [query, samples]);

  if (!open) return null;

  const toggleSample = (sampleId: string) => {
    setDraftIds((current) => {
      if (current.includes(sampleId)) return current.filter((id) => id !== sampleId);
      return [...current, sampleId];
    });
  };
  const setSampleSelected = (sampleId: string, selected: boolean) => {
    setDraftIds((current) => {
      if (selected) return current.includes(sampleId) ? current : [...current, sampleId];
      return current.filter((id) => id !== sampleId);
    });
  };
  const startDragSelection = (sampleId: string, event: MouseEvent<HTMLLabelElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    handledPointerDownRef.current = true;
    const shouldSelect = !selectedSet.has(sampleId);
    setDragMode(shouldSelect ? "select" : "deselect");
    setSampleSelected(sampleId, shouldSelect);
  };
  const toggleOptionFromRowClick = (sampleId: string, event: MouseEvent<HTMLLabelElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    if (handledPointerDownRef.current) {
      handledPointerDownRef.current = false;
      return;
    }
    toggleSample(sampleId);
  };
  const continueDragSelection = (sampleId: string, event: MouseEvent<HTMLLabelElement>) => {
    if (!dragMode || event.buttons !== 1) return;
    setSampleSelected(sampleId, dragMode === "select");
  };
  const confirmSelection = () => {
    onConfirm(samples.filter((sample) => selectedSet.has(sample.id)).map((sample) => sample.id));
  };

  return (
    <div className="sample-selection-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sample-selection-sheet">
        <div className="sample-selection-header">
          <strong>{title}</strong>
          <button className="icon-btn" type="button" aria-label="Close sample picker" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>

        <div className="sample-selection-toolbar">
          <input
            aria-label="Search samples"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search samples..."
          />
          <div className="sample-selection-shortcuts">
            <button type="button" onClick={() => setDraftIds(samples.map((sample) => sample.id))}>Select all</button>
            <button type="button" onClick={() => setDraftIds([])}>Clear all</button>
          </div>
        </div>

        <div className="sample-selection-list" onMouseUp={() => setDragMode(null)}>
          {filteredSamples.map((sample) => (
            <label
              key={sample.id}
              className="sample-selection-option"
              onMouseDown={(event) => startDragSelection(sample.id, event)}
              onClick={(event) => toggleOptionFromRowClick(sample.id, event)}
              onMouseEnter={(event) => continueDragSelection(sample.id, event)}
              onMouseMove={(event) => continueDragSelection(sample.id, event)}
            >
              <input
                type="checkbox"
                checked={selectedSet.has(sample.id)}
                onChange={() => toggleSample(sample.id)}
              />
              <span>{sample.sourceName}</span>
            </label>
          ))}
          {!filteredSamples.length && <p className="sample-selection-empty">No matching samples.</p>}
        </div>

        <div className="sample-selection-footer">
          <span>{draftIds.length} selected</span>
          <div>
            <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
            <button className="btn primary" type="button" onClick={confirmSelection}>Confirm samples</button>
          </div>
        </div>
      </div>
    </div>
  );
}
