import { create } from "zustand";
import type { StepKey } from "./types";

interface StudioState {
  projectId: string | null;
  step: StepKey;
  setProjectId: (id: string | null) => void;
  setStep: (step: StepKey) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  projectId: window.localStorage.getItem("sdrf-studio-project-id"),
  step: (window.localStorage.getItem("sdrf-studio-step") as StepKey | null) ?? "import",
  setProjectId: (id) => {
    if (id) {
      window.localStorage.setItem("sdrf-studio-project-id", id);
    } else {
      window.localStorage.removeItem("sdrf-studio-project-id");
    }
    set({ projectId: id });
  },
  setStep: (step) => {
    window.localStorage.setItem("sdrf-studio-step", step);
    set({ step });
  },
}));
