import clsx from "clsx";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { AssistantQuestion, EvidenceItem } from "../types";
import { Panel } from "./Panel";

export function AssistantPanel({
  questions = [],
  evidences = [],
  children,
  evidenceTitle = "Evidence supporting this step",
  showQuestions = true,
  showEvidence = true,
  useFallbacks = true,
}: {
  questions?: AssistantQuestion[];
  evidences?: EvidenceItem[];
  children?: ReactNode;
  evidenceTitle?: string;
  showQuestions?: boolean;
  showEvidence?: boolean;
  useFallbacks?: boolean;
}) {
  const focusedAssistant = Boolean(children) && !showQuestions && !showEvidence;
  const questionItems = useFallbacks && !questions.length ? fallbackQuestions : questions;
  const evidenceItems = useFallbacks && !evidences.length ? fallbackEvidence : evidences.slice(0, 8);
  return (
    <aside className={clsx("right-rail", focusedAssistant && "template-assistant-rail")}>
      <div className={clsx("right-rail-shell", focusedAssistant && "template-assistant-shell")}>
        <div className={clsx("right-rail-scroll", focusedAssistant && "template-assistant-scroll")}>
          <Panel className={clsx(focusedAssistant && "template-assistant-panel")}>
            <div className="rail-title"><Sparkles size={18} /> Ai Assistant</div>
            {children}
            {showQuestions && (
              <>
                <div className="tabs">
                  <button className="tab active">Questions ({questions.length})</button>
                  <button className="tab">Evidence ({evidences.length})</button>
                </div>
                <div className="question-list">
                  {questionItems.map((question, index) => (
                    <article key={question.id ?? question.title} className={clsx("question-card", `severity-${question.severity}`)}>
                      <div className="question-head">
                        <span>{index + 1}</span>
                        <strong>{question.title}</strong>
                        <em>{question.severity}</em>
                      </div>
                      <p>{question.message}</p>
                      <div className="action-row">
                        {(question.suggested_actions ?? []).slice(0, 2).map((action) => <button key={action}>{action}</button>)}
                      </div>
                    </article>
                  ))}
                  {!questionItems.length && <p className="muted">No open questions for this step.</p>}
                </div>
              </>
            )}
          </Panel>
          {showEvidence && (
            <Panel title={evidenceTitle}>
              <ul className="evidence-list">
                {evidenceItems.map((item) => (
                  <li key={item.id ?? `${item.field}-${item.source_ref}`}>
                    <span>{item.source_type}</span>
                    <strong>{item.field}</strong>
                    <em>{Math.round(item.confidence * 100)}%</em>
                  </li>
                ))}
              </ul>
              {!evidenceItems.length && <p className="muted">No evidence loaded yet.</p>}
            </Panel>
          )}
        </div>
      </div>
    </aside>
  );
}

const fallbackQuestions: AssistantQuestion[] = [
  { id: "q1", step: "ai-analysis", title: "Confirm labeling method", message: "Detected labels should be confirmed before export.", severity: "medium", suggested_actions: ["Review", "Mark label free"], status: "open", payload: {} },
  { id: "q2", step: "samples", title: "Fill required sample characteristics", message: "Organism part and disease are required by common templates.", severity: "high", suggested_actions: ["Fill in", "Use ontology"], status: "open", payload: {} },
];

const fallbackEvidence: EvidenceItem[] = [
  { id: "e1", source_type: "PRIDE", source_ref: "metadata", field: "organism", value: "Homo sapiens", confidence: 0.9, payload: {}, status: "suggested" },
  { id: "e2", source_type: "file-names", source_ref: "uploads", field: "replicates", value: "R1/R2", confidence: 0.72, payload: {}, status: "suggested" },
];
