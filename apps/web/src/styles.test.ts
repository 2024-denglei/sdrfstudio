// @ts-expect-error Vitest runs this file in Node, while the app tsconfig intentionally omits Node types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("focused assistant layout CSS", () => {
  it("docks recommendation actions as a flex footer instead of positioning them after content", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const recommendationRule = css.match(/\.template-assistant-panel \.assistant-recommendation\s*\{[^}]+\}/)?.[0] ?? "";
    const actionRule = css.match(/\.template-assistant-panel \.recommendation-actions\.compact\s*\{[^}]+\}/)?.[0] ?? "";

    expect(recommendationRule).toContain("display: flex");
    expect(recommendationRule).toContain("flex-direction: column");
    expect(actionRule).toContain("flex: 0 0 auto");
    expect(actionRule).toContain("margin-top: auto");
    expect(actionRule).not.toContain("position: absolute");
  });
});

describe("samples metadata layout CSS", () => {
  it("stacks source names and characteristics sections vertically", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const workbenchRule = css.match(/\.sample-workbench-grid\s*\{[^}]+\}/)?.[0] ?? "";

    expect(workbenchRule).toContain("grid-template-columns: 1fr");
    expect(workbenchRule).not.toContain("minmax(280px");
  });

  it("keeps the sample picker beside the value input at tablet widths", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const valueRowRule = css.match(/\.sample-value-selection-row\s*\{[^}]+\}/)?.[0] ?? "";
    const buttonRule = css.match(/\.sample-value-selection-row \.btn\s*\{[^}]+\}/)?.[0] ?? "";
    const compactMedia = css.slice(css.indexOf("@media (max-width: 520px)"), css.indexOf("@media (max-width: 900px)"));

    expect(valueRowRule).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(valueRowRule).toContain("align-items: stretch");
    expect(buttonRule).toContain("min-height: 100%");
    expect(buttonRule).toContain("white-space: nowrap");
    expect(compactMedia).toContain(".sample-value-selection-row");
    expect(compactMedia).toContain(".sample-naming-mode");
    expect(compactMedia).toContain(".sample-pattern-card-grid");
  });

  it("separates sample count and sample naming into stacked cards", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const cardRule = css.match(/\.sample-count-card,\s*\.sample-naming-card\s*\{[^}]+\}/)?.[0] ?? "";
    const titleRule = css.match(/\.sample-setup-title\s*\{[^}]+\}/)?.[0] ?? "";
    const countWidthRule = css.match(/\.sample-count-card input\s*\{[^}]+\}/)?.[0] ?? "";
    const inputRule = css.match(/\.sample-count-card input,\s*\.sample-custom-name-entry input\s*\{[^}]+\}/)?.[0] ?? "";

    expect(cardRule).toContain("border-color: #bfdbfe");
    expect(cardRule).toContain("background: #fff");
    expect(titleRule).toContain("display: flex");
    expect(titleRule).toContain("align-items: center");
    expect(countWidthRule).toContain("width: 100%");
    expect(inputRule).toContain("min-height: 42px");
    expect(inputRule).toContain("box-sizing: border-box");
  });

  it("renders sample naming modes, compact auto patterns, and inline roster preview", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const modeRule = css.match(/\.sample-naming-mode\s*\{[^}]+\}/)?.[0] ?? "";
    const optionRule = css.match(/\.sample-naming-option\s*\{[^}]+\}/)?.[0] ?? "";
    const patternGridRule = css.match(/\.sample-pattern-card-grid\s*\{[^}]+\}/)?.[0] ?? "";
    const patternCardRule = css.match(/\.sample-pattern-card\s*\{[^}]+\}/)?.[0] ?? "";
    const patternLabelRule = css.match(/\.sample-pattern-card span\s*\{[^}]+\}/)?.[0] ?? "";
    const customEntryRule = css.match(/\.sample-custom-name-entry\s*\{[^}]+\}/)?.[0] ?? "";
    const rosterRule = css.match(/\.sample-inline-roster\s*\{[^}]+\}/)?.[0] ?? "";

    expect(modeRule).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(optionRule).toContain("display: grid");
    expect(optionRule).toContain("min-height: 72px");
    expect(patternGridRule).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(patternCardRule).toContain("display: flex");
    expect(patternCardRule).toContain("justify-content: center");
    expect(patternCardRule).toContain("min-height: 34px");
    expect(patternCardRule).toContain("padding: 6px 8px");
    expect(patternLabelRule).toContain("white-space: nowrap");
    expect(customEntryRule).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(rosterRule).toContain("border: 1px dashed #bfdbfe");
  });

  it("keeps roster control cards stacked vertically", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const stackRule = css.match(/\.sample-roster-stack\s*\{[^}]+\}/)?.[0] ?? "";
    const panelRule = css.match(/\.sample-roster-panel\s*\{[^}]+\}/)?.[0] ?? "";

    expect(stackRule).toContain("display: grid");
    expect(stackRule).toContain("grid-template-columns: 1fr");
    expect(panelRule).toContain("border: 1px solid #dbeafe");
    expect(panelRule).toContain("border-radius: 8px");
    expect(panelRule).toContain("background: #f8fbff");
  });

  it("renders assignment values as blue ontology labels", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const assignmentValueRule = css.match(/\.sample-assignment-row \.sample-assignment-value\s*\{[^}]+\}/)?.[0] ?? "";
    const accessionRule = css.match(/\.sample-assignment-row \.sample-assignment-value \.sample-assignment-accession\s*\{[^}]+\}/)?.[0] ?? "";

    expect(assignmentValueRule).toContain("color: #155bd4");
    expect(assignmentValueRule).toContain("font-weight: 900");
    expect(accessionRule).toContain("font-size: 11px");
    expect(accessionRule).toContain("font-weight: 400");
  });

  it("presents each assignment property as an individual card", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const assignmentFieldRule = css.match(/\.sample-assignment-field\s*\{[^}]+\}/)?.[0] ?? "";
    const focusRule = css.match(/\.sample-assignment-field:focus-within\s*\{[^}]+\}/)?.[0] ?? "";

    expect(assignmentFieldRule).toContain("border: 1px solid #dbeafe");
    expect(assignmentFieldRule).toContain("border-radius: 8px");
    expect(assignmentFieldRule).toContain("background: #fff");
    expect(assignmentFieldRule).toContain("padding: 12px");
    expect(assignmentFieldRule).not.toContain("border-bottom");
    expect(focusRule).toContain("border-color: #93c5fd");
  });
});
