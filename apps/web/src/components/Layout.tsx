import clsx from "clsx";
import { Box, HelpCircle, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { steps, stepIndex } from "../workflow";
import { useStudioStore } from "../store";
import type { Project, StepKey } from "../types";

export function Layout({ project, children, headerAction }: { project?: Project; children: ReactNode; headerAction?: ReactNode }) {
  const { step, setStep } = useStudioStore();
  const activeIndex = stepIndex(step);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Box size={20} /></div>
          <div>
            <div className="brand-title">Proteomics</div>
            <div className="brand-title">SDRF Studio</div>
          </div>
        </div>
        <nav className="nav-list">
          {steps.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={clsx("nav-item", step === item.key && "active")} onClick={() => setStep(item.key)}>
                <Icon size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button className={clsx("nav-item", settingsOpen && "active")} onClick={() => setSettingsOpen(true)}><Settings size={18} /><span>Settings</span></button>
          <button className="nav-item"><HelpCircle size={18} /><span>Help</span></button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">{project?.pride_accession ? `Project: ${project.pride_accession}` : "New Project"} / Step {activeIndex + 1} of 10</div>
            <h1>{steps[activeIndex].label === "Import" ? "Import & Create New Project" : pageTitle(step)}</h1>
          </div>
          {headerAction && <div className="topbar-actions">{headerAction}</div>}
        </header>
        {children}
      </main>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

interface AiConfig {
  model: string;
}

const DEFAULT_AI_CONFIG: AiConfig = {
  model: "",
};

function readAiConfig(): AiConfig {
  try {
    const saved = window.localStorage.getItem("sdrf-studio-ai-config");
    return saved ? { ...DEFAULT_AI_CONFIG, ...JSON.parse(saved) } : DEFAULT_AI_CONFIG;
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<AiConfig>(readAiConfig);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const updateConfig = (patch: Partial<AiConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setSaved(false);
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-panel" aria-label="Settings">
        <div className="settings-header">
          <div>
            <strong>Settings</strong>
            <p>Cloud AI credentials are configured on the server. Optionally choose a model for this browser.</p>
          </div>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="settings-form">
          <label>
            <span>Model</span>
            <input value={config.model} onChange={(event) => updateConfig({ model: event.target.value })} placeholder="Use server default" />
          </label>
        </div>
        <div className="settings-actions">
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify(config));
              setSaved(true);
            }}
          >
            Save AI settings
          </button>
          {saved && <span className="success-text">Saved.</span>}
        </div>
      </section>
    </div>
  );
}

function pageTitle(step: StepKey): string {
  return {
    import: "Import & Create New Project",
    "ai-analysis": "Templates & AI Selection",
    blueprint: "Study Blueprint & Mapping Assistant",
    samples: "Samples & Characteristics",
    files: "Technical Configuration & Files",
    "ai-review": "AI Review",
    validation: "Validation",
    export: "Export SDRF",
  }[step];
}
