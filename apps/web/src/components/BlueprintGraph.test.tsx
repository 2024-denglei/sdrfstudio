import { describe, expect, it } from "vitest";
import { displayBlueprintGraphNodeLabel, layoutBlueprintGraphNodes, type BlueprintGraphNode } from "./BlueprintGraph";

describe("layoutBlueprintGraphNodes", () => {
  it("spaces group nodes by group order even when earlier groups create many relationship nodes", () => {
    const nodes: BlueprintGraphNode[] = [
      { id: "group-control", label: "Control_Untreated", layer: "group", kind: "group" },
      ...Array.from({ length: 13 }, (_, index): BlueprintGraphNode => ({
        id: `control-detail-${index}`,
        label: `Control detail ${index}`,
        layer: index % 2 === 0 ? "biological_replicate" : "fractionation",
      })),
      { id: "group-egf5", label: "EGF_5min", layer: "group", kind: "group" },
      { id: "group-egf15", label: "EGF_15min", layer: "group", kind: "group" },
      { id: "group-noco", label: "Nocodazole_Mitotic", layer: "group", kind: "group" },
      { id: "group-pervanadate", label: "Pervanadate_CalyculinA", layer: "group", kind: "group" },
    ];

    const laidOutGroups = layoutBlueprintGraphNodes(nodes)
      .filter((node) => node.id.startsWith("group-"))
      .map((node) => node.position.y);

    expect(new Set(laidOutGroups).size).toBe(5);
    expect(laidOutGroups).toEqual([104, 186, 268, 350, 432]);
  });

  it("compacts long raw file labels while keeping the distinguishing suffix", () => {
    const label = displayBlueprintGraphNodeLabel({
      id: "raw-1",
      layer: "file",
      kind: "file",
      label: "Raw file: 20120308_EXQ5_KiSh_SA_LabelFree_HeLa_Proteome_EGF5_rep4_pH8.raw",
    });

    expect(label).toContain("...");
    expect(label).toMatch(/rep4_pH8\.raw$/);
    expect(label.length).toBeLessThan(56);
  });
});
