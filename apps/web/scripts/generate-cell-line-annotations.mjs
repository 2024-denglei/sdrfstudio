import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = process.argv[2] ?? "E:/bigbio/sdrf-skills/data/cl-annotations-db.tsv";
const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cellLineAnnotations.generated.ts");

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const headers = lines.shift().split("\t").map(clean);
  return lines.map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, clean(cells[index])]));
  });
}

const rows = parseTsv(readFileSync(sourcePath, "utf8")).map((row) => ({
  cellLine: row["cell line"],
  cellosaurusName: row["cellosaurus name"],
  cellosaurusAccession: row["cellosaurus accession"],
  btoCellLine: row["bto cell line"],
  organism: row.organism,
  organismPart: row["organism part"],
  samplingSite: row["sampling site"],
  age: row.age,
  developmentalStage: row["developmental stage"],
  sex: row.sex,
  ancestryCategory: row["ancestry category"],
  disease: row.disease,
  cellType: row["cell type"],
  materialType: row["Material type"],
  synonyms: row.synonyms,
  curated: row.curated,
}));

const output = `export type CellLineAnnotationRecord = {
  cellLine: string;
  cellosaurusName: string;
  cellosaurusAccession: string;
  btoCellLine: string;
  organism: string;
  organismPart: string;
  samplingSite: string;
  age: string;
  developmentalStage: string;
  sex: string;
  ancestryCategory: string;
  disease: string;
  cellType: string;
  materialType: string;
  synonyms: string;
  curated: string;
};

export const CELL_LINE_ANNOTATION_SOURCE = "cl-annotations-db.tsv";

export const CELL_LINE_ANNOTATIONS: CellLineAnnotationRecord[] = ${JSON.stringify(rows, null, 2)};
`;

writeFileSync(outputPath, output);
console.log(`Wrote ${rows.length} cell-line annotations to ${outputPath}`);
