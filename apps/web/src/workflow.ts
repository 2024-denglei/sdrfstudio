import {
  Beaker,
  CheckCircle2,
  Database,
  FileDown,
  FolderOpen,
  GitBranch,
  Layers,
  ShieldCheck,
} from "lucide-react";
import type { StepKey } from "./types";

export const steps: { key: StepKey; label: string; icon: typeof Database }[] = [
  { key: "import", label: "Import", icon: Database },
  { key: "ai-analysis", label: "Templates", icon: Layers },
  { key: "samples", label: "Samples", icon: Beaker },
  { key: "blueprint", label: "Blueprint", icon: GitBranch },
  { key: "files", label: "Files", icon: FolderOpen },
  { key: "ai-review", label: "AI Review", icon: ShieldCheck },
  { key: "validation", label: "Validation", icon: CheckCircle2 },
  { key: "export", label: "Export", icon: FileDown },
];

export function stepIndex(step: StepKey): number {
  return Math.max(0, steps.findIndex((item) => item.key === step));
}
