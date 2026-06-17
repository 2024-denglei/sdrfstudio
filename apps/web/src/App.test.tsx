import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, BlueprintStep, ImportStep, SamplesStep, SAMPLE_AI_REQUEST_TIMEOUT_MS, SAMPLE_DESIGN_JSON_SYSTEM_PROMPT, SDRF_TEMPLATE_RECOMMENDATION_SYSTEM_PROMPT, SDRF_VALUE_NORMALIZATION_SYSTEM_PROMPT, TEMPLATE_AI_REQUEST_TIMEOUT_MS, formatAiResponseError, inferTemplateRecommendation, shouldReloadBlankAppRoot } from "./App";
import { api } from "./api";
import { AssistantPanel } from "./components/AssistantPanel";
import { Layout } from "./components/Layout";
import { useStudioStore } from "./store";
import type { Analysis, SdrfTable, StepKey, UploadedFile } from "./types";
import { steps } from "./workflow";

function renderImportStep(files: React.ComponentProps<typeof ImportStep>["files"] = [], options: { preserveSession?: boolean } = {}) {
  if (!options.preserveSession) window.localStorage.removeItem("sdrf-studio-session-state:project-1");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ImportStep projectId="project-1" files={files} refresh={() => undefined} />
    </QueryClientProvider>,
  );
}

function renderBlueprintStep(
  analysis: React.ComponentProps<typeof BlueprintStep>["analysis"],
  table?: React.ComponentProps<typeof BlueprintStep>["table"],
) {
  vi.stubGlobal("ResizeObserver", class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BlueprintStep projectId="project-1" analysis={analysis} table={table} refresh={() => undefined} />
    </QueryClientProvider>,
  );
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function projectFixture(overrides: Partial<Awaited<ReturnType<typeof api.listProjects>>[number]> = {}) {
  return {
    id: "project-1",
    name: "Test project",
    description: "",
    status: "draft",
    pride_accession: null,
    current_step: "import" as const,
    created_at: "2026-05-18T00:00:00Z",
    updated_at: "2026-05-18T00:00:00Z",
    ...overrides,
  };
}

function renderSamplesStep(props: Partial<React.ComponentProps<typeof SamplesStep>> = {}, client = createTestQueryClient()) {
  if (typeof globalThis.fetch !== "function" || !vi.isMockFunction(globalThis.fetch)) {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network calls are disabled in SamplesStep tests.")));
  }
  return render(
    <QueryClientProvider client={client}>
      <SamplesStep
        projectId="project-1"
        analysis={props.analysis ?? { evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} }}
        table={props.table ?? {
          id: "table-1",
          project_id: "project-1",
          headers: ["source name", "characteristics[organism]", "characteristics[organism part]", "characteristics[disease]", "characteristics[biological replicate]"],
          rows: [],
          column_metadata: {},
          dirty: false,
          validation_state: {},
        }}
        refresh={props.refresh ?? (() => undefined)}
      />
    </QueryClientProvider>,
  );
}

function renderAppAtStep(
  step: StepKey,
  options: {
    table?: SdrfTable;
    files?: UploadedFile[];
    analysis?: Analysis;
  } = {},
) {
  window.localStorage.setItem("sdrf-studio-project-id", "project-1");
  window.localStorage.setItem("sdrf-studio-step", step);
  window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
    version: 2,
    projectId: "project-1",
    displayName: "Test project",
    currentStep: step,
    step,
  }));
  useStudioStore.setState({ projectId: "project-1", step });
  vi.spyOn(api, "listProjects").mockResolvedValue([projectFixture({ id: "project-1", current_step: step })]);
  vi.spyOn(api, "listFiles").mockResolvedValue(options.files ?? []);
  vi.spyOn(api, "getAnalysis").mockResolvedValue(options.analysis ?? { evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} });
  vi.spyOn(api, "getSdrfTable").mockResolvedValue(options.table ?? {
    id: "table-1",
    project_id: "project-1",
    headers: ["source name"],
    rows: [],
    column_metadata: {},
    dirty: false,
    validation_state: {},
  });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <App />
    </QueryClientProvider>,
  );
}

async function selectSamplesForField(field: HTMLElement, displayLabel: string, sampleNames: string[]) {
  await userEvent.click(within(field).getByRole("button", { name: `Select samples for ${displayLabel}` }));
  expect(screen.getByRole("dialog", { name: `Select samples (${displayLabel})` })).toBeTruthy();
  for (const sampleName of sampleNames) {
    await userEvent.click(screen.getByRole("checkbox", { name: sampleName }));
  }
  await userEvent.click(screen.getByRole("button", { name: "Confirm samples" }));
}

async function selectAllSamplesForField(field: HTMLElement, displayLabel: string) {
  await userEvent.click(within(field).getByRole("button", { name: `Select samples for ${displayLabel}` }));
  expect(screen.getByRole("dialog", { name: `Select samples (${displayLabel})` })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Select all" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm samples" }));
}

describe("blank page recovery", () => {
  it("detects an emptied app root without treating normal app content as blank", () => {
    const blankRoot = document.createElement("div");
    expect(shouldReloadBlankAppRoot(blankRoot)).toBe(true);

    const populatedRoot = document.createElement("div");
    populatedRoot.innerHTML = `<main class="content-grid">Samples</main>`;
    expect(shouldReloadBlankAppRoot(populatedRoot)).toBe(false);

    const loadingRoot = document.createElement("div");
    loadingRoot.innerHTML = `<div class="loading-state">Loading...</div>`;
    expect(shouldReloadBlankAppRoot(loadingRoot)).toBe(false);
  });
});

describe("AI request handling", () => {
  it("allows template recommendations to wait as long as Samples AI", () => {
    expect(TEMPLATE_AI_REQUEST_TIMEOUT_MS).toBe(SAMPLE_AI_REQUEST_TIMEOUT_MS);
  });

  it("includes provider response body in AI failure messages", async () => {
    const message = await formatAiResponseError(
      "AI template recommendation failed",
      new Response(JSON.stringify({ error: { message: "upstream model overloaded" } }), { status: 503 }),
    );

    expect(message).toContain("503");
    expect(message).toContain("upstream model overloaded");
  });
});

describe("ImportStep", () => {
  afterEach(() => cleanup());
  afterEach(() => {
    window.localStorage.removeItem("sdrf-studio-ai-config");
    window.localStorage.removeItem("sdrf-studio-files-ai-draft:project-1");
    window.localStorage.removeItem("sdrf-studio-session-state:project-1");
    window.localStorage.removeItem("sdrf-studio-project-id");
    window.localStorage.removeItem("sdrf-studio-step");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows only the PRIDE module by default", () => {
    renderImportStep();

    expect(screen.getByText("2. Import from PRIDE Archive")).toBeTruthy();
    expect(screen.queryByText("2B. Import local experimental design files")).toBeNull();
    expect(screen.queryByText("2C. Start from scratch")).toBeNull();
    expect(screen.queryByText("Existing SDRF")).toBeNull();
    expect(screen.queryByText("Detect existing SDRF files")).toBeNull();
  });

  it("puts the continue action in the sticky title bar", async () => {
    const onContinue = vi.fn();
    render(
      <Layout
        project={{
          id: "project-1",
          name: "Test project",
          description: "",
          status: "draft",
          pride_accession: null,
          current_step: "import",
          created_at: "2026-05-18T00:00:00Z",
          updated_at: "2026-05-18T00:00:00Z",
        }}
        headerAction={<button type="button" onClick={onContinue}>Continue</button>}
      >
        <div>Import content</div>
      </Layout>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("lets users permanently delete a saved session from the session switcher", async () => {
    const sessionToDelete = projectFixture({
      id: "project-delete",
      name: "Imported session",
      pride_accession: "PXD000612",
    });
    const remainingSession = projectFixture({
      id: "project-keep",
      name: "Remaining session",
      updated_at: "2026-05-19T00:00:00Z",
    });
    window.localStorage.setItem("sdrf-studio-project-id", sessionToDelete.id);
    window.localStorage.setItem("sdrf-studio-session-state:project-delete", JSON.stringify({
      version: 2,
      projectId: "project-delete",
      displayName: "PXD000612 - Ultra-deep human phosphoproteome",
      currentStep: "samples",
    }));

    const deleteProject = vi.spyOn(api, "deleteProject").mockResolvedValue({ status: "deleted" });
    vi.spyOn(api, "listProjects").mockResolvedValue([sessionToDelete, remainingSession]);
    vi.spyOn(api, "listFiles").mockResolvedValue([]);
    vi.spyOn(api, "getAnalysis").mockResolvedValue({ evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} });
    vi.spyOn(api, "getSdrfTable").mockResolvedValue({
      id: "table-1",
      project_id: "project-delete",
      headers: ["source name"],
      rows: [],
      column_metadata: {},
      dirty: false,
      validation_state: {},
    });
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <App />
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: /PXD000612/ }));
    await userEvent.click(screen.getByRole("button", { name: /Delete session PXD000612/ }));

    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("project-delete"));
    expect(window.localStorage.getItem("sdrf-studio-session-state:project-delete")).toBeNull();
    await waitFor(() => expect(window.localStorage.getItem("sdrf-studio-project-id")).toBe("project-keep"));
  });

  it("switches to the local upload module after choosing local data files", async () => {
    renderImportStep();

    await userEvent.click(screen.getByRole("button", { name: /I have local data files/i }));

    expect(screen.getByText("2B. Import local experimental design files")).toBeTruthy();
    expect(screen.queryByText("2. Import from PRIDE Archive")).toBeNull();
    expect(screen.queryByText("2C. Start from scratch")).toBeNull();
  });

  it("switches to the scratch module after choosing start from scratch", async () => {
    renderImportStep();

    await userEvent.click(screen.getByRole("button", { name: /Start from scratch/i }));

    expect(screen.getByText("2C. Start from scratch")).toBeTruthy();
    expect(screen.queryByText("2. Import from PRIDE Archive")).toBeNull();
    expect(screen.queryByText("2B. Import local experimental design files")).toBeNull();
  });

  it("shows expandable PRIDE import result details", async () => {
    vi.spyOn(api, "importPride").mockResolvedValue({
      accession: "PXD000070",
      project: {
        accession: "PXD000070",
        title: "Example PRIDE project",
        projectDescription: "A test project",
        organisms: ["Homo sapiens"],
      },
      files: {
        _embedded: {
          files: [
            { fileName: "sample_01.raw" },
            { fileName: "project.sdrf.tsv" },
          ],
        },
      },
    });
    renderImportStep();

    await userEvent.type(screen.getByPlaceholderText("PXD012345"), "PXD000070");
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    await screen.findByText("Import results");
    await userEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);

    expect(screen.getByText("Example PRIDE project")).toBeTruthy();
    expect(screen.getByText("Homo sapiens")).toBeTruthy();
    expect(screen.queryByText("Existing SDRF")).toBeNull();
    expect(screen.queryByText("project.sdrf.tsv")).toBeNull();
    const session = JSON.parse(window.localStorage.getItem("sdrf-studio-session-state:project-1") ?? "{}");
    expect(session.import.prideImportResults[0].title).toBe("Project metadata");
  });

  it("does not offer existing SDRF files in local or design uploads", async () => {
    renderImportStep();

    await userEvent.click(screen.getByRole("button", { name: /I have local data files/i }));

    expect(screen.getByText("2B. Import local experimental design files")).toBeTruthy();
    expect(screen.getByText("Supports CSV, TSV, XLSX, PDF and supplementary metadata")).toBeTruthy();
    expect(screen.queryByText(/existing SDRF/i)).toBeNull();
    expect(screen.queryByText(/Supports .*SDRF/)).toBeNull();
    expect(Array.from(document.querySelectorAll("input[type='file']")).some((input) => input.getAttribute("accept")?.includes("sdrf"))).toBe(false);
  });

  it("restores saved PRIDE import details when returning to Import", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      version: 2,
      projectId: "project-1",
      import: {
        accession: "PXD000612",
        activeImportAccession: "PXD000612",
        prideAccession: "PXD000612",
        prideTitle: "Saved Plasmodium project",
        prideOrganisms: ["Plasmodium falciparum"],
        prideInstruments: ["LTQ Orbitrap Velos"],
        rawFileCount: 12,
        importedAt: "2026-05-18T00:00:00.000Z",
        startMode: "pride",
      },
    }));

    renderImportStep([], { preserveSession: true });

    expect((screen.getByPlaceholderText("PXD012345") as HTMLInputElement).value).toBe("PXD000612");
    expect(screen.getByText("Import results")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "View details" })[0]);

    expect(screen.getByText("Saved Plasmodium project")).toBeTruthy();
    expect(screen.getByText("Plasmodium falciparum")).toBeTruthy();
    expect(screen.getByText("Do you have an experimental design CSV?")).toBeTruthy();
  });

  it("refreshes restored publication details after uploading a PDF", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      version: 2,
      projectId: "project-1",
      import: {
        accession: "PXD000612",
        activeImportAccession: "PXD000612",
        prideAccession: "PXD000612",
        prideTitle: "Saved project with publication",
        publicationCount: 1,
        importedAt: "2026-05-18T00:00:00.000Z",
        startMode: "pride",
        prideImportResults: [{
          title: "Publication PDF or full text",
          status: "missing",
          message: "1 publication reference(s) were resolved, but PDF access is not open. Use the journal link to download it, then upload the PDF here.",
          details: [
            {
              kind: "table",
              title: "Resolved publications",
              columns: [
                { key: "title", label: "Title" },
                { key: "access_status", label: "Access status" },
              ],
              rows: [{ title: "PXD000612 paper", access_status: "Publisher/journal access" }],
            },
            { kind: "upload", title: "Publication PDF", label: "Upload PDF", accept: "application/pdf,.pdf", mode: "pdf" },
          ],
        }],
      },
    }));
    const uploadFile = vi.spyOn(api, "uploadFile").mockResolvedValue({
      id: "uploaded-pdf",
      project_id: "project-1",
      filename: "PXD000612_paper.pdf",
      content_type: "application/pdf",
      file_type: "publication-pdf",
      sha256: "pdf",
      size_bytes: 300,
      parse_status: "uploaded",
      parsed_payload: {},
      created_at: "2026-05-18T01:00:00.000Z",
    });
    const client = createTestQueryClient();
    const uploadedFiles = [{
      id: "uploaded-pdf",
      project_id: "project-1",
      filename: "PXD000612_paper.pdf",
      content_type: "application/pdf",
      file_type: "publication-pdf",
      sha256: "pdf",
      size_bytes: 300,
      parse_status: "uploaded",
      parsed_payload: {},
      created_at: "2026-05-18T01:00:00.000Z",
    }];
    const view = render(
      <QueryClientProvider client={client}>
        <ImportStep projectId="project-1" files={[]} refresh={() => undefined} />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "View details" }));
    await userEvent.upload(screen.getByLabelText("Upload PDF"), new File(["pdf"], "paper.pdf", { type: "application/pdf" }));

    await waitFor(() => expect(uploadFile).toHaveBeenCalled());
    const uploadedFile = uploadFile.mock.calls[0][1];
    expect(uploadedFile.name).toBe("PXD000612_paper.pdf");

    view.rerender(
      <QueryClientProvider client={client}>
        <ImportStep projectId="project-1" files={uploadedFiles} refresh={() => undefined} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Current uploaded publication PDF")).toBeTruthy();
    expect(screen.getByText("PXD000612_paper.pdf")).toBeTruthy();
    expect(screen.getByText("Replace PDF")).toBeTruthy();
    expect(screen.getByText(/View uploaded PDF: PXD000612_paper\.pdf/)).toBeTruthy();
  });

  it("does not reuse an uploaded publication PDF from another PRIDE accession", async () => {
    vi.spyOn(api, "importPride").mockResolvedValue({
      accession: "PXD000612",
      project: {
        accession: "PXD000612",
        publications: [
          {
            title: "PXD000612 paper",
            doi: "10.1016/j.celrep.2014.07.036",
            is_open_access: false,
            access_status: "publisher_access",
            article_url: "https://doi.org/10.1016/j.celrep.2014.07.036",
          },
        ],
        publication_access_summary: { publisher_links: 1 },
      },
      files: {},
    });
    renderImportStep([
      {
        id: "file-1",
        project_id: "project-1",
        filename: "PXD000547.pdf",
        content_type: "application/pdf",
        file_type: "publication-pdf",
        sha256: "abc",
        size_bytes: 100,
        parse_status: "uploaded",
        parsed_payload: {},
        created_at: new Date().toISOString(),
      },
    ]);

    await userEvent.type(screen.getByPlaceholderText("PXD012345"), "PXD000612");
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    await screen.findByText("Publication PDF or full text");

    expect(screen.getByText(/PDF access is not open/i)).toBeTruthy();
    expect(screen.queryByText("Upload PDF")).toBeNull();
    expect(screen.queryByText(/PXD000547\.pdf/)).toBeNull();
  });

  it("fetches from PRIDE when pressing Enter in the accession field", async () => {
    const importPride = vi.spyOn(api, "importPride").mockResolvedValue({
      accession: "PXD000547",
      project: { accession: "PXD000547", title: "Enter key project" },
      files: {},
    });
    renderImportStep();

    await userEvent.type(screen.getByPlaceholderText("PXD012345"), "PXD000547{enter}");

    expect(importPride).toHaveBeenCalledWith("project-1", "PXD000547");
    await screen.findByText("Import results");
  });

  it("asks whether the user has an experimental design CSV after fetching PRIDE", async () => {
    vi.spyOn(api, "importPride").mockResolvedValue({
      accession: "PXD000070",
      project: { accession: "PXD000070", title: "PRIDE project" },
      files: {},
    });
    renderImportStep();

    expect(screen.queryByText("3. Experimental design file mapping")).toBeNull();
    await userEvent.type(screen.getByPlaceholderText("PXD012345"), "PXD000070");
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));

    await screen.findByText("Do you have an experimental design CSV?");
    expect(screen.queryByText("3. Experimental design file mapping")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Yes, upload CSV" }));

    expect(screen.getByText("3. Experimental design CSV")).toBeTruthy();
    expect(screen.queryByText("3. Experimental design file mapping")).toBeNull();
    expect(screen.getByRole("button", { name: "Yes, upload CSV" })).toBeTruthy();
  });

  it("prompts users to continue to Templates when they do not have a design CSV", async () => {
    vi.spyOn(api, "importPride").mockResolvedValue({
      accession: "PXD000070",
      project: { accession: "PXD000070", title: "PRIDE project" },
      files: {},
    });
    renderImportStep();

    await userEvent.type(screen.getByPlaceholderText("PXD012345"), "PXD000070");
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    await screen.findByText("Do you have an experimental design CSV?");
    await userEvent.click(screen.getByRole("button", { name: "No, continue to Templates" }));

    expect(screen.queryByText("3. Experimental design file mapping")).toBeNull();
    expect(screen.getByText("No design CSV selected. Continue to Templates to choose the SDRF template stack from imported PRIDE evidence.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue to Templates" })).toBeTruthy();
  });

  it("shows only the latest uploaded PDF with replace and view controls", async () => {
    vi.spyOn(api, "importPride").mockResolvedValue({
      accession: "PXD000612",
      project: {
        accession: "PXD000612",
        publications: [{ title: "PXD000612 paper", is_open_access: false, access_status: "publisher_access" }],
        publication_access_summary: { publisher_links: 1 },
      },
      files: {},
    });
    renderImportStep([
      {
        id: "old-file",
        project_id: "project-1",
        filename: "PXD000612_old.pdf",
        content_type: "application/pdf",
        file_type: "publication-pdf",
        sha256: "old",
        size_bytes: 100,
        parse_status: "uploaded",
        parsed_payload: {},
        created_at: "2026-05-15T00:00:00.000Z",
      },
      {
        id: "new-file",
        project_id: "project-1",
        filename: "PXD000612_new.pdf",
        content_type: "application/pdf",
        file_type: "publication-pdf",
        sha256: "new",
        size_bytes: 200,
        parse_status: "uploaded",
        parsed_payload: {},
        created_at: "2026-05-15T01:00:00.000Z",
      },
    ]);

    await userEvent.type(screen.getByPlaceholderText("PXD012345"), "PXD000612");
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    await screen.findByText("Publication PDF or full text");
    const publicationCard = screen.getByText("Publication PDF or full text").closest("article");
    expect(publicationCard).toBeTruthy();
    await userEvent.click(within(publicationCard as HTMLElement).getByRole("button", { name: "View details" }));

    expect(screen.getByText("PXD000612_new.pdf")).toBeTruthy();
    expect(screen.queryByText("PXD000612_old.pdf")).toBeNull();
    expect(screen.getByText("Replace PDF")).toBeTruthy();
    expect(screen.getByText(/View uploaded PDF: PXD000612_new\.pdf/)).toBeTruthy();
  });

  it("shows AI suggested SDRF mapping reasons and editable mapped preview for an uploaded design file", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://api.silra.cn/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
    }));
    const aiFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                mappings: [
                  { uploaded_column: "sample_name", sdrf_field: "source name", reason: "The column contains sample identifiers." },
                  { uploaded_column: "disease", sdrf_field: "characteristics[disease]", reason: "The values describe disease state." },
                  { uploaded_column: "raw_file", sdrf_field: "comment[data file]", reason: "The values are raw data file names." },
                  { uploaded_column: "fraction", sdrf_field: "comment[fraction identifier]", reason: "The values identify fractions." },
                ],
                file_mapping_status: "mappable",
                file_mapping_reason: "The uploaded file has columns that correspond to SDRF sample and file metadata.",
              }),
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                normalized_rows: [{ "source name": "sample1", "characteristics[disease]": "healthy", "comment[data file]": "sample1.raw", "comment[fraction identifier]": "F1" }],
                changes: [],
                validation_summary: "All mapped values are compatible with the selected SDRF fields.",
              }),
            },
          }],
        }),
      });
    vi.stubGlobal("fetch", aiFetch);
    renderImportStep([
      {
        id: "design-1",
        project_id: "project-1",
        filename: "design.csv",
        content_type: "text/csv",
        file_type: "design-table",
        sha256: "design",
        size_bytes: 120,
        parse_status: "parsed",
        parsed_payload: {
          headers: ["sample_name", "disease", "raw_file", "fraction"],
          rows: [{ sample_name: "sample1", disease: "healthy", raw_file: "sample1.raw", fraction: "F1" }],
        },
        created_at: "2026-05-15T02:00:00.000Z",
      },
    ]);

    expect(screen.getByText("3. Experimental design CSV")).toBeTruthy();
    expect(screen.queryByText("3. Experimental design file mapping")).toBeNull();
    expect(screen.getByText("design.csv")).toBeTruthy();
    expect(screen.getByText("Uploaded design file preview")).toBeTruthy();
    expect(screen.getByText("Column mapping")).toBeTruthy();
    expect(screen.getByDisplayValue("sample1")).toBeTruthy();
    expect(aiFetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Ask AI to map columns" }));
    await screen.findByText("The column contains sample identifiers.");
    expect(aiFetch.mock.calls[0][0]).toBe("http://localhost:8000/api/ai/chat");
    expect(aiFetch.mock.calls[0][1]?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.stringify(aiFetch.mock.calls[0][1]?.headers)).not.toContain("test-key");
    expect(screen.getAllByText("sample_name").length).toBeGreaterThan(0);
    expect(screen.getAllByText("raw_file").length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue("source name").length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue("comment[data file]").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Validate SDRF values" }));

    expect(screen.getByText("Mapped SDRF preview")).toBeTruthy();
    await screen.findByText("All mapped values are compatible with the selected SDRF fields.");
    expect(screen.getByText("Mapping validated.")).toBeTruthy();
    expect(screen.getAllByDisplayValue("sample1").length).toBeGreaterThan(0);
    const rawFileInputs = screen.getAllByDisplayValue("sample1.raw");
    const rawFileInput = rawFileInputs[rawFileInputs.length - 1];
    await userEvent.clear(rawFileInput);
    await userEvent.type(rawFileInput, "corrected.raw");
    expect(screen.getByDisplayValue("corrected.raw")).toBeTruthy();
  });

  it("uses AI to normalize mapped values to SDRF-compatible values", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://api.silra.cn/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                mappings: [
                  { uploaded_column: "sample name", sdrf_field: "source name", reason: "Sample identifiers." },
                  { uploaded_column: "tissue", sdrf_field: "characteristics[organism part]", reason: "Tissue values." },
                  { uploaded_column: "age", sdrf_field: "characteristics[age]", reason: "Age values." },
                  { uploaded_column: "sex", sdrf_field: "characteristics[sex]", reason: "Sex values." },
                ],
                file_mapping_status: "mappable",
                file_mapping_reason: "The file contains sample characteristics.",
              }),
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                normalized_rows: [
                  { "source name": "sample 1", "characteristics[organism part]": "liver", "characteristics[age]": "24Y", "characteristics[sex]": "female" },
                  { "source name": "sample 2", "characteristics[organism part]": "liver", "characteristics[age]": "40Y", "characteristics[sex]": "male" },
                ],
                changes: [
                  { row_index: 0, field: "characteristics[age]", original_value: "24", normalized_value: "24Y", severity: "info", reason: "Numeric age was converted to years." },
                  { row_index: 0, field: "characteristics[sex]", original_value: "F", normalized_value: "female", severity: "info", reason: "Sex abbreviation was expanded." },
                  { row_index: 1, field: "characteristics[sex]", original_value: "M", normalized_value: "male", severity: "info", reason: "Sex abbreviation was expanded." },
                ],
                validation_summary: "AI normalized age units and sex values for SDRF.",
              }),
            },
          }],
        }),
      }));

    renderImportStep([
      {
        id: "design-1",
        project_id: "project-1",
        filename: "design.csv",
        content_type: "text/csv",
        file_type: "design-table",
        sha256: "design",
        size_bytes: 120,
        parse_status: "parsed",
        parsed_payload: {
          headers: ["sample name", "tissue", "age", "sex"],
          rows: [
            { "sample name": "sample 1", tissue: "liver", age: "24", sex: "F" },
            { "sample name": "sample 2", tissue: "liver", age: "40", sex: "M" },
          ],
        },
        created_at: "2026-05-15T02:00:00.000Z",
      },
    ]);

    expect(screen.getByText("Uploaded design file preview")).toBeTruthy();
    expect(screen.getByDisplayValue("24")).toBeTruthy();
    expect(screen.getByDisplayValue("F")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Ask AI to map columns" }));
    await screen.findByText("Age values.");
    await userEvent.click(screen.getByRole("button", { name: "Validate SDRF values" }));

    await screen.findByText("AI normalized age units and sex values for SDRF.");
    expect(screen.getByDisplayValue("24Y")).toBeTruthy();
    expect(screen.getByDisplayValue("female")).toBeTruthy();
    expect(screen.getByDisplayValue("male")).toBeTruthy();
    expect(screen.queryByText("AI repairs applied")).toBeNull();
    expect(screen.queryByText("Numeric age was converted to years.")).toBeNull();
  });

  it("keeps the SDRF value normalization prompt explicit about age and sex formats", () => {
    expect(SDRF_VALUE_NORMALIZATION_SYSTEM_PROMPT).toContain("characteristics[age]");
    expect(SDRF_VALUE_NORMALIZATION_SYSTEM_PROMPT).toContain("24 -> 24Y");
    expect(SDRF_VALUE_NORMALIZATION_SYSTEM_PROMPT).toContain("F/female -> female");
    expect(SDRF_VALUE_NORMALIZATION_SYSTEM_PROMPT).toContain("M/male -> male");
  });

  it("keeps the template recommendation prompt aligned with SDRF template architecture", () => {
    expect(SDRF_TEMPLATE_RECOMMENDATION_SYSTEM_PROMPT).toContain("exactly one technology template");
    expect(SDRF_TEMPLATE_RECOMMENDATION_SYSTEM_PROMPT).toContain("Clinical-metadata and oncology-metadata are overlays");
    expect(SDRF_TEMPLATE_RECOMMENDATION_SYSTEM_PROMPT).toContain("labeling keywords are evidence only");
  });

  it("keeps the sample AI prompt aligned with editable JSON handoff", () => {
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("sdrf-core-mapping-v1");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("SDRF-Proteomics v1.1.0");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("Each mapping_rows item is one SDRF row");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("comment[proteomics data acquisition method]");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("comment[label]");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("comment[fraction identifier]");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("comment[technical replicate]");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("comment[data file]");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("Do not put acquisition_method into factor_values");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("label free sample");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("Discover relationship layers dynamically from evidence");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("relationship_layers must describe the ordered Blueprint path inferred from evidence");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).not.toContain("8 source-level samples split into 2 pools");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).not.toContain("20 fractions");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).not.toContain("pooled_sample_rules");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("Do not use existing SDRF files");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("mapping row represents");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("mapping_rows must include every raw_file_names item");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("raw_file_design_summary");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("classify every observed field");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("Do not hard-code project-specific tokens");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("allowed_metadata_fields only");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("Every required metadata field must be present");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("Recommended, context, and optional metadata fields");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("value, reason, and sources");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("coverage_check.missing_biological_conditions");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).toContain("left-side sample roster and attribute assignment editor");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).not.toContain("current_sdrf_table_summary");
    expect(SAMPLE_DESIGN_JSON_SYSTEM_PROMPT).not.toContain("core_mapping_candidate");
  });

  it("allows long-running sample AI requests", () => {
    expect(SAMPLE_AI_REQUEST_TIMEOUT_MS).toBe(600_000);
  });

  it("does not auto-map columns without AI configuration", () => {
    renderImportStep([
      {
        id: "design-1",
        project_id: "project-1",
        filename: "PXD000070.csv",
        content_type: "text/csv",
        file_type: "design-table",
        sha256: "design",
        size_bytes: 120,
        parse_status: "parsed",
        parsed_payload: { headers: ["sample name", "tissue", "age", "sex"], rows: [] },
        created_at: "2026-05-15T02:00:00.000Z",
      },
    ]);

    expect(screen.getByText("Design file loaded. Review or edit the table, then map columns manually or ask AI for suggestions.")).toBeTruthy();
    expect(screen.queryByDisplayValue("source name")).toBeNull();
    expect(screen.queryByDisplayValue("characteristics[organism part]")).toBeNull();
    expect(screen.queryByDisplayValue("characteristics[age]")).toBeNull();
    expect(screen.queryByDisplayValue("characteristics[sex]")).toBeNull();
  });

  it("lets users delete an uploaded experimental design file", async () => {
    const deleteFile = vi.spyOn(api, "deleteFile").mockResolvedValue({ status: "deleted" });
    renderImportStep([
      {
        id: "design-1",
        project_id: "project-1",
        filename: "PXD000070.csv",
        content_type: "text/csv",
        file_type: "design-table",
        sha256: "design",
        size_bytes: 120,
        parse_status: "parsed",
        parsed_payload: { headers: ["sample name"], rows: [{ "sample name": "sample 1" }] },
        created_at: "2026-05-15T02:00:00.000Z",
      },
    ]);

    expect(screen.getByText("PXD000070.csv")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(deleteFile).toHaveBeenCalledWith("project-1", "design-1");
  });

  it("shows the AI reason when a design file cannot be mapped", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://api.silra.cn/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              mappings: [
                { uploaded_column: "notes", sdrf_field: "", reason: "Free-text notes do not identify SDRF sample, assay, or file metadata." },
              ],
              file_mapping_status: "not_mappable",
              file_mapping_reason: "The uploaded file contains only free-text notes and no structured experimental design columns.",
            }),
          },
        }],
      }),
    }));

    renderImportStep([
      {
        id: "design-1",
        project_id: "project-1",
        filename: "PXD000070.csv",
        content_type: "text/csv",
        file_type: "design-table",
        sha256: "design",
        size_bytes: 120,
        parse_status: "parsed",
        parsed_payload: { headers: ["notes"], rows: [{ notes: "No structured metadata here" }] },
        created_at: "2026-05-15T02:00:00.000Z",
      },
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Ask AI to map columns" }));
    await screen.findByText("AI did not find usable column mappings. You can map columns manually.");
    expect(screen.getByText("Free-text notes do not identify SDRF sample, assay, or file metadata.")).toBeTruthy();
    expect(screen.getByText("The uploaded file contains only free-text notes and no structured experimental design columns.")).toBeTruthy();
    expect(screen.queryByDisplayValue("source name")).toBeNull();
  });

  it("recommends a template stack from imported SDRF evidence", () => {
    const recommendation = inferTemplateRecommendation([
      {
        id: "e1",
        source_type: "pride",
        source_ref: "PXD000001",
        field: "project accession",
        value: "PXD000001",
        confidence: 0.95,
        payload: {
          project: {
            organism: ["Homo sapiens"],
            description: "DIA TMT proteomics study",
          },
        },
        status: "suggested",
      },
      {
        id: "e2",
        source_type: "text",
        source_ref: "methods",
        field: "acquisition method",
        value: "data-independent acquisition with TMT labels",
        confidence: 0.82,
        payload: {},
        status: "suggested",
      },
    ], []);

    expect(recommendation.selectedIds).toContain("ms-proteomics");
    expect(recommendation.selectedIds).toContain("human");
    expect(recommendation.selectedIds).toContain("dia-acquisition");
    expect(recommendation.selectedIds).not.toContain("labeling");
    expect(recommendation.evidenceLabels.join(" ")).toContain("labeling");
  });

  it("prefers affinity-proteomics as the only technology template when affinity evidence is present", () => {
    const recommendation = inferTemplateRecommendation([
      {
        id: "e1",
        source_type: "text",
        source_ref: "assay",
        field: "technology",
        value: "Olink and SomaScan affinity proteomics assay kit",
        confidence: 0.9,
        payload: {},
        status: "suggested",
      },
    ], []);

    expect(recommendation.selectedIds).toContain("affinity-proteomics");
    expect(recommendation.selectedIds).not.toContain("ms-proteomics");
    expect(recommendation.selectedIds).not.toContain("dia-acquisition");
  });

  it("prefers a metaproteomics sample context over a generic human template", () => {
    const recommendation = inferTemplateRecommendation([
      {
        id: "e1",
        source_type: "text",
        source_ref: "sample",
        field: "organism",
        value: "human gut microbiome and stool samples",
        confidence: 0.88,
        payload: {},
        status: "suggested",
      },
    ], []);

    expect(recommendation.selectedIds).toContain("human-gut");
    expect(recommendation.selectedIds).not.toContain("human");
    expect(recommendation.selectedIds).not.toContain("vertebrates");
  });
});

describe("BlueprintStep", () => {
  afterEach(() => cleanup());
  afterEach(() => {
    window.localStorage.removeItem("sdrf-studio-session-state:project-1");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lets users manually add a blueprint item and saves it", async () => {
    const putBlueprint = vi.spyOn(api, "putBlueprint").mockImplementation(async (_projectId, blueprint) => blueprint);
    renderBlueprintStep({ evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} });

    await userEvent.type(screen.getByPlaceholderText("e.g. TMT fraction 1"), "Manual sample");
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    expect((await screen.findAllByText("Manual sample")).length).toBeGreaterThan(0);
    expect(putBlueprint).toHaveBeenCalledWith("project-1", expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ label: "Manual sample", status: "confirmed" })]),
    }));
  });

  it("adds the AI blueprint draft with one click", async () => {
    const putBlueprint = vi.spyOn(api, "putBlueprint").mockImplementation(async (_projectId, blueprint) => blueprint);
    const { container } = renderBlueprintStep({
      evidences: [],
      questions: [],
      blueprint: {
        nodes: [
          { id: "sample-1", layer: "sample", label: "AI sample", payload: {}, confidence: 0.8, status: "suggested" },
          { id: "assay-1", layer: "assay", label: "AI assay", payload: {}, confidence: 0.7, status: "suggested" },
        ],
        edges: [{ id: "edge-1", source_id: "sample-1", target_id: "assay-1", relation: "maps_to", confidence: 0.7, status: "suggested" }],
      },
      summary: {},
    });

    await userEvent.click(screen.getByRole("button", { name: /AI one-click add/i }));

    expect(await screen.findByText("AI blueprint added.")).toBeTruthy();
    expect(putBlueprint).toHaveBeenCalledWith("project-1", expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ label: "AI sample" })]),
      edges: expect.arrayContaining([expect.objectContaining({ source_id: "sample-1", target_id: "assay-1" })]),
    }));
  });

  it("builds a sample-driven relationship graph from applied Samples rows", async () => {
    renderBlueprintStep(
      { evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} },
      {
        id: "table-1",
        project_id: "project-1",
        headers: [
          "source name",
          "factor value[treatment]",
          "characteristics[biological replicate]",
          "comment[fractionation method]",
          "comment[fraction identifier]",
          "comment[technical replicate]",
          "assay name",
          "comment[data file]",
        ],
        rows: [
          {
            "source name": "ctrl_01",
            "factor value[treatment]": "control",
            "characteristics[biological replicate]": "BR1",
            "comment[fractionation method]": "high pH",
            "comment[fraction identifier]": "F1",
            "comment[technical replicate]": "TR1",
            "assay name": "assay_ctrl_01",
            "comment[data file]": "ctrl_01_F1.raw",
          },
          {
            "source name": "ctrl_02",
            "factor value[treatment]": "control",
            "characteristics[biological replicate]": "BR2",
            "comment[fractionation method]": "high pH",
            "comment[fraction identifier]": "F2",
            "comment[technical replicate]": "TR1",
            "assay name": "assay_ctrl_02",
            "comment[data file]": "ctrl_02_F2.raw",
          },
          {
            "source name": "egf_01",
            "factor value[treatment]": "EGF",
            "characteristics[biological replicate]": "BR1",
            "comment[fractionation method]": "high pH",
            "comment[fraction identifier]": "F1",
            "comment[technical replicate]": "TR2",
            "assay name": "assay_egf_01",
            "comment[data file]": "egf_01_F1.raw",
          },
        ],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    );

    expect(screen.getByText("Sample-driven blueprint")).toBeTruthy();
    const sampleGroups = screen.getByLabelText("Sample groups");
    expect(within(sampleGroups).getByRole("button", { name: /treatment: control/i })).toBeTruthy();
    await userEvent.click(within(sampleGroups).getByRole("button", { name: /treatment: EGF/i }));

    const detail = screen.getByLabelText("Selected sample group details");
    expect(within(detail).getAllByText("egf_01").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("BR1").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("high pH (F1)").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("TR2").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("assay_egf_01").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("egf_01_F1.raw").length).toBeGreaterThan(0);
  });

  it("prefers accepted Samples AI group names over SDRF table regrouping", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          sample_groups: [
            {
              group_name: "Control baseline",
              sample_count: 2,
              naming_prefix: "ctrl0",
              metadata: { treatment: { value: "control" }, timePoint: { value: "0 min" } },
              factor_values: ["factor value[treatment]", "factor value[time point]"],
              assay_context: { fractionation: "high pH", fractions: ["F1"], technical_replicate: "TR1", assay_name: "assay_ctrl0", raw_files: ["ctrl0_01.raw"] },
            },
            {
              group_name: "EGF 5 min",
              sample_count: 2,
              naming_prefix: "egf5",
              metadata: { treatment: { value: "EGF" }, timePoint: { value: "5 min" } },
              factor_values: ["factor value[treatment]", "factor value[time point]"],
              assay_context: { fractionation: "high pH", fractions: ["F1"], technical_replicate: "TR1", assay_name: "assay_egf5", raw_files: ["egf5_01.raw"] },
            },
            {
              group_name: "EGF 15 min",
              sample_count: 2,
              naming_prefix: "egf15",
              metadata: { treatment: { value: "EGF" }, timePoint: { value: "15 min" } },
              factor_values: ["factor value[treatment]", "factor value[time point]"],
              assay_context: { fractionation: "high pH", fractions: ["F1"], technical_replicate: "TR1", assay_name: "assay_egf15", raw_files: ["egf15_01.raw"] },
            },
            {
              group_name: "Nocodazole",
              sample_count: 2,
              naming_prefix: "noco",
              metadata: { treatment: { value: "nocodazole" }, timePoint: { value: "not available" } },
              factor_values: ["factor value[treatment]", "factor value[time point]"],
              assay_context: { fractionation: "high pH", fractions: ["F1"], technical_replicate: "TR1", assay_name: "assay_noco", raw_files: ["noco_01.raw"] },
            },
            {
              group_name: "Pervanadate",
              sample_count: 2,
              naming_prefix: "pv",
              metadata: { treatment: { value: "pervanadate" }, timePoint: { value: "not available" } },
              factor_values: ["factor value[treatment]", "factor value[time point]"],
              assay_context: { fractionation: "high pH", fractions: ["F1"], technical_replicate: "TR1", assay_name: "assay_pv", raw_files: ["pv_01.raw"] },
            },
          ],
          summary: "Five AI sample groups.",
          sources: [],
        },
      },
    }));
    renderBlueprintStep(
      { evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} },
      {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "factor value[treatment]", "comment[data file]"],
        rows: [
          { "source name": "ctrl0_01", "factor value[treatment]": "control", "comment[data file]": "ctrl0_01.raw" },
          { "source name": "egf5_01", "factor value[treatment]": "EGF", "comment[data file]": "egf5_01.raw" },
          { "source name": "egf15_01", "factor value[treatment]": "EGF", "comment[data file]": "egf15_01.raw" },
          { "source name": "noco_01", "factor value[treatment]": "nocodazole", "comment[data file]": "noco_01.raw" },
          { "source name": "pv_01", "factor value[treatment]": "pervanadate", "comment[data file]": "pv_01.raw" },
        ],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    );

    const sampleGroups = screen.getByLabelText("Sample groups");
    expect(within(sampleGroups).getByRole("button", { name: /Control baseline/i })).toBeTruthy();
    expect(within(sampleGroups).getByRole("button", { name: /EGF 5 min/i })).toBeTruthy();
    expect(within(sampleGroups).getByRole("button", { name: /EGF 15 min/i })).toBeTruthy();
    expect(within(sampleGroups).getByRole("button", { name: /Nocodazole/i })).toBeTruthy();
    expect(within(sampleGroups).getByRole("button", { name: /Pervanadate/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /treatment: EGF/i })).toBeNull();
  });

  it("builds blueprint rows from imported raw files when accepted Samples AI has groups but no mapping rows", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          sample_groups: [
            {
              group_name: "Control_Asynchronous",
              sample_count: 6,
              naming_prefix: "hela_s3_asynch",
              metadata: {
                organism: { value: "Homo sapiens" },
                disease: { value: "cervical adenocarcinoma" },
                treatment: { value: "control" },
              },
              factor_values: ["factor value[treatment]"],
              assay_context: { fractionated: true, label_free: true, workflows: ["Proteome", "Phospho", "pY"] },
            },
            {
              group_name: "EGF_5min",
              sample_count: 4,
              naming_prefix: "hela_s3_egf5",
              metadata: {
                organism: { value: "Homo sapiens" },
                disease: { value: "cervical adenocarcinoma" },
                treatment: { value: "EGF" },
                timePoint: { value: "5 min" },
              },
              factor_values: ["factor value[treatment]", "factor value[time point]"],
              assay_context: { fractionated: true, workflows: ["Proteome", "Phospho", "pY"] },
            },
          ],
          mapping_rows: [],
          summary: "PXD000612-like AI grouping without explicit core rows.",
          sources: [],
        },
      },
    }));

    const { container } = renderBlueprintStep({
      evidences: [{
        id: "evidence-raw",
        source_type: "sample-evidence",
        source_ref: "PXD000612",
        field: "sample evidence bundle",
        value: "raw_files=3",
        confidence: 0.9,
        payload: {
          raw_file_summary: {
            raw_file_names: [
              "20120126_EXQ5_KiSh_SA_LabelFree_HeLa_Phospho_Control_rep1_Fr1.raw",
              "20120206_EXQ5_KiSh_SA_LabelFree_HeLa_Phospho_Control_rep6_FT2.raw",
              "20120302_EXQ5_KiSh_SA_LabelFree_HeLa_Proteome_EGF5_rep1_pH3.raw",
            ],
          },
        },
        status: "accepted",
      }],
      questions: [],
      blueprint: { nodes: [], edges: [] },
      summary: {},
    });

    const detail = screen.getByLabelText("Selected sample group details");
    expect(within(detail).getAllByText("20120126_EXQ5_KiSh_SA_LabelFree_HeLa_Phospho_Control_rep1_Fr1.raw").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("20120206_EXQ5_KiSh_SA_LabelFree_HeLa_Phospho_Control_rep6_FT2.raw").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("Phospho (Fr1)").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("label free sample").length).toBeGreaterThan(0);
    expect(within(detail).queryByText("true")).toBeNull();
    await userEvent.click(within(screen.getByLabelText("Sample groups")).getByRole("button", { name: /EGF_5min/i }));
    const egfDetail = screen.getByLabelText("Selected sample group details");
    expect(within(egfDetail).getAllByText("20120302_EXQ5_KiSh_SA_LabelFree_HeLa_Proteome_EGF5_rep1_pH3.raw").length).toBeGreaterThan(0);
  });

  it("keeps accepted Samples AI groups separate when AI mapping rows are incomplete or assigned to one group", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          sample_groups: [
            {
              group_name: "Control_Asynchronous",
              sample_count: 6,
              naming_prefix: "hela_s3_asynch",
              metadata: { treatment: { value: "control" } },
              factor_values: ["factor value[treatment]"],
              assay_context: { label_free: true, workflows: ["Proteome", "Phospho", "pY"] },
            },
            {
              group_name: "MitoticArrest_Release",
              sample_count: 4,
              naming_prefix: "hela_s3_mitotic",
              metadata: { treatment: { value: "nocodazole" } },
              factor_values: ["factor value[treatment]"],
              assay_context: { label_free: true, workflows: ["Proteome", "Phospho", "pY"] },
            },
            {
              group_name: "EGF_5min",
              sample_count: 4,
              naming_prefix: "hela_s3_egf5",
              metadata: { treatment: { value: "EGF" }, timePoint: { value: "5 min" } },
              factor_values: ["factor value[treatment]", "factor value[time point]"],
              assay_context: { label_free: true, workflows: ["Proteome", "Phospho", "pY"] },
            },
            {
              group_name: "EGF_15min",
              sample_count: 4,
              naming_prefix: "hela_s3_egf15",
              metadata: { treatment: { value: "EGF" }, timePoint: { value: "15 min" } },
              factor_values: ["factor value[treatment]", "factor value[time point]"],
              assay_context: { label_free: true, workflows: ["Proteome", "Phospho", "pY"] },
            },
            {
              group_name: "Pervanadate_CalyculinA",
              sample_count: 4,
              naming_prefix: "hela_s3_pv",
              metadata: { treatment: { value: "pervanadate" } },
              factor_values: ["factor value[treatment]"],
              assay_context: { label_free: true, workflows: ["Proteome", "Phospho", "pY"] },
            },
          ],
          mapping_rows: [{
            source_name: "hela_s3_egf5_01",
            sample_group: "EGF_5min",
            biological_replicate: "1",
            data_file: "20120308_EXQ5_KiSh_SA_LabelFree_HeLa_Proteome_EGF5_rep4_pH8.raw",
          }],
          summary: "Five accepted Samples AI groups.",
          sources: [],
        },
      },
    }));

    const { container } = renderBlueprintStep({
      evidences: [{
        id: "evidence-raw",
        source_type: "sample-evidence",
        source_ref: "PXD000612",
        field: "sample evidence bundle",
        value: "raw_files=5",
        confidence: 0.9,
        payload: {
          raw_file_summary: {
            raw_file_names: [
              "20120126_EXQ5_KiSh_SA_LabelFree_HeLa_Phospho_Control_rep1_Fr1.raw",
              "20120130_EXQ5_KiSh_SA_LabelFree_HeLa_Proteome_EGF15_rep1_pH11.raw",
              "20120308_EXQ5_KiSh_SA_LabelFree_HeLa_Proteome_EGF5_rep4_pH8.raw",
              "20120402_EXQ5_KiSh_SA_LabelFree_HeLa_Phospho_PV_rep4_pH11.raw",
              "20120206_EXQ5_KiSh_SA_LabelFree_HeLa_Phospho_Nocodazole_rep2_Fr6.raw",
            ],
          },
        },
        status: "accepted",
      }],
      questions: [],
      blueprint: { nodes: [], edges: [] },
      summary: {},
    });

    const sampleGroups = screen.getByLabelText("Sample groups");
    expect(within(sampleGroups).getByRole("button", { name: /Control_Asynchronous/i })).toBeTruthy();
    expect(within(sampleGroups).getByRole("button", { name: /MitoticArrest_Release/i })).toBeTruthy();
    expect(within(sampleGroups).getByRole("button", { name: /EGF_5min/i })).toBeTruthy();
    expect(within(sampleGroups).getByRole("button", { name: /EGF_15min/i })).toBeTruthy();
    expect(within(sampleGroups).getByRole("button", { name: /Pervanadate_CalyculinA/i })).toBeTruthy();
    expect(screen.getByText("Sample group")).toBeTruthy();
    expect(screen.getAllByText("Sample").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Biological replicate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Label").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fractionation").length).toBeGreaterThan(0);
    const graphElement = container.querySelector(".blueprint-graph");
    expect(graphElement).toBeTruthy();
    const graph = within(graphElement as HTMLElement);
    expect(graph.getByText("Biological replicate")).toBeTruthy();
    expect(screen.getAllByText("hela_s3_asynch_01").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sample: hela_s3_asynch_01")).toBeNull();
    expect(screen.queryByText("Label: label free sample")).toBeNull();

    await userEvent.click(within(sampleGroups).getByRole("button", { name: /Control_Asynchronous/i }));
    let detail = screen.getByLabelText("Selected sample group details");
    expect(within(detail).getAllByText("20120126_EXQ5_KiSh_SA_LabelFree_HeLa_Phospho_Control_rep1_Fr1.raw").length).toBeGreaterThan(0);
    expect(within(detail).queryByText("20120308_EXQ5_KiSh_SA_LabelFree_HeLa_Proteome_EGF5_rep4_pH8.raw")).toBeNull();

    await userEvent.click(within(sampleGroups).getByRole("button", { name: /EGF_5min/i }));
    detail = screen.getByLabelText("Selected sample group details");
    expect(within(detail).getAllByText("hela_s3_egf5_04").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("20120308_EXQ5_KiSh_SA_LabelFree_HeLa_Proteome_EGF5_rep4_pH8.raw").length).toBeGreaterThan(0);
    expect(within(detail).queryByText("20120126_EXQ5_KiSh_SA_LabelFree_HeLa_Phospho_Control_rep1_Fr1.raw")).toBeNull();
  });

  it("uses accepted Samples AI mapping rows for core blueprint mappings and applies them", async () => {
    const putBlueprint = vi.spyOn(api, "putBlueprint").mockImplementation(async (_projectId, blueprint) => blueprint);
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          sample_groups: [
            {
              group_name: "Control_Untreated",
              sample_count: 1,
              naming_prefix: "hctrl",
              metadata: { treatment: { value: "control" } },
              factor_values: ["factor value[treatment]"],
            },
            {
              group_name: "EGF_5min",
              sample_count: 1,
              naming_prefix: "egf5",
              metadata: { treatment: { value: "EGF" }, timePoint: { value: "5 min" } },
              factor_values: ["factor value[treatment]", "factor value[time point]"],
            },
          ],
          mapping_rows: [
            {
              source_name: "hctrl_01",
              biological_sample_id: "hctrl_01",
              sample_group: "Control_Untreated",
              biological_replicate: "BR1",
              label: "TMT126",
              fraction_id: "F1",
              acquisition_method: "DT",
              technical_replicate: "TR1",
              assay_name: "assay_hctrl_01",
              data_file: "hctrl_01.raw",
            },
            {
              source_name: "egf5_01",
              biological_sample_id: "egf5_01",
              sample_group: "EGF_5min",
              biological_replicate: "BR1",
              label: "TMT127",
              fraction_id: "F2",
              acquisition_method: "DDNL",
              technical_replicate: "TR1",
              assay_name: "assay_egf5_01",
              data_file: "egf5_01.raw",
            },
          ],
          summary: "Sample groups and core mapping rows.",
          sources: [],
        },
      },
    }));

    renderBlueprintStep({ evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} });

    const sampleGroups = screen.getByLabelText("Sample groups");
    expect(within(sampleGroups).getByRole("button", { name: /EGF_5min[\s\S]*egf5_01/i })).toBeTruthy();
    await userEvent.click(within(sampleGroups).getByRole("button", { name: /EGF_5min/i }));
    const detail = screen.getByLabelText("Selected sample group details");
    expect(within(detail).getAllByText("egf5_01").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("F2").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("TMT127").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("DDNL").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("TR1").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("assay_egf5_01").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("egf5_01.raw").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Label").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Acquisition").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TMT127").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DDNL").length).toBeGreaterThan(0);
    expect(screen.queryByText("Label: TMT127")).toBeNull();
    expect(screen.queryByText("Acquisition: DDNL")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Apply AI core mapping/i }));

    await waitFor(() => expect(putBlueprint).toHaveBeenCalledWith("project-1", expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({ layer: "sample", label: "egf5_01" }),
        expect.objectContaining({ layer: "assay", label: "Assay: assay_egf5_01" }),
        expect.objectContaining({ layer: "file", label: "Raw file: egf5_01.raw" }),
      ]),
    })));
    expect(await screen.findByText("AI core mapping applied.")).toBeTruthy();
    expect(screen.getByText("Add item")).toBeTruthy();
    expect(screen.getByText("Mappings")).toBeTruthy();
  });

  it("uses AI relationship layers to render pooled biological samples without unavailable graph layers", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          sample_groups: [{
            group_name: "CC (Corpus Callosum)",
            sample_count: 8,
            naming_prefix: "cc",
            metadata: { organism: { value: "Mus musculus" }, organismPart: { value: "corpus callosum" } },
            factor_values: ["factor value[organism part]"],
          }],
          mapping_rows: [
            {
              source_name: "cc_pool_01",
              biological_sample_id: "cc_pool_01",
              sample_group: "CC (Corpus Callosum)",
              biological_replicate: "pool 1",
              pool_id: "pool_01",
              pool_members: ["cc_01", "cc_02", "cc_03", "cc_04"],
              label: "label free sample",
              preparation: "SDS-PAGE fractionation (GelC-MS/MS)",
              fraction_id: "Slice01",
              technical_replicate: "1",
              assay_name: "assay_cc_pool01_slice01",
              data_file: "pool01_slice01.raw",
            },
            {
              source_name: "cc_pool_01",
              biological_sample_id: "cc_pool_01",
              sample_group: "CC (Corpus Callosum)",
              biological_replicate: "pool 1",
              pool_id: "pool_01",
              pool_members: ["cc_01", "cc_02", "cc_03", "cc_04"],
              label: "label free sample",
              preparation: "SDS-PAGE fractionation (GelC-MS/MS)",
              fraction_id: "Slice02",
              technical_replicate: "1",
              assay_name: "assay_cc_pool01_slice02",
              data_file: "pool01_slice02.raw",
            },
            {
              source_name: "cc_pool_02",
              biological_sample_id: "cc_pool_02",
              sample_group: "CC (Corpus Callosum)",
              biological_replicate: "pool 2",
              pool_id: "pool_02",
              pool_members: ["cc_05", "cc_06", "cc_07", "cc_08"],
              label: "label free sample",
              preparation: "SDS-PAGE fractionation (GelC-MS/MS)",
              fraction_id: "Slice01",
              technical_replicate: "1",
              assay_name: "assay_cc_pool02_slice01",
              data_file: "pool02_slice01.raw",
            },
          ],
          relationship_layers: [
            { field: "biological_replicate", label: "Bio rep", role: "biological_replicate", reason: "Pool-level biological replicate is supported by the evidence." },
            { field: "pool_id", label: "Pool", role: "aggregation", reason: "The evidence contains an aggregation layer." },
            { field: "label", label: "Label", role: "label_channel", reason: "The evidence states label-free samples." },
            { field: "fraction_id", label: "Fraction", role: "preparation", reason: "The evidence contains fraction identifiers." },
            { field: "assay_name", label: "Assay", role: "assay", reason: "Assay names identify row-level assay runs." },
            { field: "data_file", label: "Raw file", role: "data_file", reason: "Data files close each SDRF row." },
          ],
          summary: "Eight samples split into two pools with fractionated files.",
          sources: [],
        },
      },
    }));

    renderBlueprintStep({ evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} });

    expect(screen.getByRole("button", { name: /CC \(Corpus Callosum\)[\s\S]*cc_01, cc_02, cc_03/i })).toBeTruthy();
    const detail = screen.getByLabelText("Selected sample group details");
    for (const sample of ["cc_01", "cc_02", "cc_03", "cc_04", "cc_05", "cc_06", "cc_07", "cc_08"]) {
      expect(within(detail).getByText(sample)).toBeTruthy();
    }
    expect(within(detail).getAllByText("pool_01").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("pool_02").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pool").length).toBeGreaterThan(0);
    expect(screen.getAllByText("pool_01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("pool_02").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Pool: pool_01/)).toBeNull();
    expect(screen.queryByText(/Pool: pool_02/)).toBeNull();
    expect(screen.queryByText("Acquisition: not available")).toBeNull();
  });

  it("paginates a PXD000547-style pooled fractionated blueprint by group-specific fraction", async () => {
    const subjects = [
      ["01", "pool_cc_br1"],
      ["02", "pool_cc_br1"],
      ["03", "pool_cc_br1"],
      ["04", "pool_cc_br1"],
      ["05", "pool_cc_br2"],
      ["06", "pool_cc_br2"],
      ["07", "pool_cc_br2"],
      ["08", "pool_cc_br2"],
    ];
    const mappingRows = Array.from({ length: 20 }, (_, index) => {
      const slice = String(index + 1).padStart(2, "0");
      return [1, 2].map((poolIndex) => {
        const groupName = poolIndex === 1 ? "CC_BioRep1" : "CC_BioRep2";
        const poolId = poolIndex === 1 ? "pool_cc_br1" : "pool_cc_br2";
        return {
          source_name: poolId,
          biological_sample_id: poolId,
          sample_group: groupName,
          biological_replicate: String(poolIndex),
          pool_id: poolId,
          pool_members: poolIndex === 1 ? ["01", "02", "03", "04"] : ["05", "06", "07", "08"],
          label: "label free sample",
          preparation: "SDS-PAGE fractionation (GelC-MS/MS)",
          fraction_id: slice,
          technical_replicate: "1",
          assay_name: `assay_cc_pool${String(poolIndex).padStart(2, "0")}_slice${slice}`,
          data_file: `dms_04Jul13_CC_Proteome_Slice${slice}_${String(poolIndex).padStart(2, "0")}.RAW`,
        };
      });
    }).flat();
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          biological_samples: subjects.map(([sourceName, poolId]) => ({
            source_name: sourceName,
            biological_sample_id: `subject_${sourceName}`,
            sample_group: poolId === "pool_cc_br1" ? "CC_BioRep1" : "CC_BioRep2",
            pool_id: poolId,
            metadata: { organism: "Homo sapiens", organism_part: "corpus callosum" },
          })),
          sample_groups: [
            {
              group_name: "CC_BioRep1",
              sample_count: 4,
              naming_prefix: "cc_br1",
              metadata: { organism: "Homo sapiens", organism_part: "corpus callosum" },
              factor_values: [],
            },
            {
              group_name: "CC_BioRep2",
              sample_count: 4,
              naming_prefix: "cc_br2",
              metadata: { organism: "Homo sapiens", organism_part: "corpus callosum" },
              factor_values: [],
            },
          ],
          mapping_rows: mappingRows,
          relationship_layers: [
            { field: "biological_replicate", label: "Bio rep", role: "biological_replicate" },
            { field: "pool_id", label: "Pool", role: "aggregation" },
            { field: "label", label: "Label", role: "label_channel" },
            { field: "fraction_id", label: "Fraction", role: "preparation" },
            { field: "technical_replicate", label: "Tech rep", role: "technical_replicate" },
            { field: "assay_name", label: "Assay", role: "assay" },
            { field: "data_file", label: "Raw file", role: "data_file" },
          ],
          summary: "Eight source-level subjects are represented in two corpus callosum pools with 20 fractions each.",
          sources: [],
        },
      },
    }));

    const { container } = renderBlueprintStep({ evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} });

    expect(screen.getByText("Relationship view")).toBeTruthy();
    expect(screen.getByText("Current view: All relationships, showing 40 of 40 raw files.")).toBeTruthy();
    const relationshipGroups = screen.getByLabelText("Relationship groups");
    expect(within(relationshipGroups).getByRole("button", { name: /^All$/i })).toBeTruthy();
    expect(within(relationshipGroups).getByRole("button", { name: /^CC_BioRep1$/i })).toBeTruthy();
    expect(within(relationshipGroups).getByRole("button", { name: /^CC_BioRep2$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /CC_BioRep1[\s\S]*01, 02, 03/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /CC_BioRep2[\s\S]*05, 06, 07/i })).toBeTruthy();

    const graph = within(container.querySelector(".blueprint-graph") as HTMLElement);
    expect(graph.getAllByText("dms_04Jul13_CC_Proteome_Slice01_01.RAW").length).toBeGreaterThan(0);
    expect(graph.getAllByText("dms_04Jul13_CC_Proteome_Slice20_01.RAW").length).toBeGreaterThan(0);
    const currentRows = screen.getByLabelText("Current core mapping rows");
    expect(within(currentRows).getByText("dms_04Jul13_CC_Proteome_Slice01_01.RAW")).toBeTruthy();
    expect(within(currentRows).getByText("dms_04Jul13_CC_Proteome_Slice20_01.RAW")).toBeTruthy();
    const detail = screen.getByLabelText("Selected sample group details");
    expect(within(detail).getByLabelText("Core SDRF relationship rows")).toBeTruthy();
    expect(detail.querySelector(".sample-blueprint-facts")).toBeNull();

    await userEvent.click(within(relationshipGroups).getByRole("button", { name: /CC_BioRep1/i }));
    const groupFractionView = screen.getByLabelText("Group fraction view");
    expect(within(groupFractionView).getByRole("button", { name: /^F1$/i })).toBeTruthy();
    expect(within(groupFractionView).getByRole("button", { name: /^F20$/i })).toBeTruthy();

    await userEvent.click(within(groupFractionView).getByRole("button", { name: /^F20$/i }));

    const updatedGraph = within(container.querySelector(".blueprint-graph") as HTMLElement);
    expect(updatedGraph.getAllByText("dms_04Jul13_CC_Proteome_Slice20_01.RAW").length).toBeGreaterThan(0);
    expect(updatedGraph.queryByText("dms_04Jul13_CC_Proteome_Slice01_01.RAW")).toBeNull();
    expect(updatedGraph.queryByText("dms_04Jul13_CC_Proteome_Slice20_02.RAW")).toBeNull();
    expect(within(screen.getByLabelText("Current core mapping rows")).getByText("dms_04Jul13_CC_Proteome_Slice20_01.RAW")).toBeTruthy();

    await userEvent.click(within(relationshipGroups).getByRole("button", { name: /^All$/i }));

    expect(screen.getByText("Current view: All relationships, showing 40 of 40 raw files.")).toBeTruthy();
    const allGraph = within(container.querySelector(".blueprint-graph") as HTMLElement);
    expect(allGraph.getAllByText("dms_04Jul13_CC_Proteome_Slice01_01.RAW").length).toBeGreaterThan(0);
    expect(allGraph.getAllByText("dms_04Jul13_CC_Proteome_Slice20_01.RAW").length).toBeGreaterThan(0);
  });

  it("groups relationship fractions by sample group when groups have different fraction counts", async () => {
    const mappingRows = [
      { group: "CC_Pool1", pool: "pool1", members: ["01", "02", "03", "04"], fraction: "01", raw: "pool1_slice01.raw" },
      { group: "CC_Pool1", pool: "pool1", members: ["01", "02", "03", "04"], fraction: "02", raw: "pool1_slice02.raw" },
      { group: "CC_Pool1", pool: "pool1", members: ["01", "02", "03", "04"], fraction: "03", raw: "pool1_slice03.raw" },
      { group: "CC_Pool2", pool: "pool2", members: ["05", "06", "07", "08"], fraction: "01", raw: "pool2_slice01.raw" },
      { group: "CC_Pool2", pool: "pool2", members: ["05", "06", "07", "08"], fraction: "02", raw: "pool2_slice02.raw" },
    ].map((row) => ({
      source_name: row.group,
      biological_sample_id: row.group,
      sample_group: row.group,
      biological_replicate: row.pool,
      pool_id: row.pool,
      pool_members: row.members,
      label: "label-free",
      preparation: "SDS-PAGE fractionation",
      fraction_id: row.fraction,
      technical_replicate: "1",
      assay_name: `${row.group}_fraction_${row.fraction}`,
      data_file: row.raw,
    }));
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          biological_samples: ["01", "02", "03", "04", "05", "06", "07", "08"].map((sourceName) => ({
            source_name: sourceName,
            biological_sample_id: `subject_${sourceName}`,
            sample_group: Number(sourceName) <= 4 ? "CC_Pool1" : "CC_Pool2",
            pool_id: Number(sourceName) <= 4 ? "pool1" : "pool2",
            metadata: { organism: "Homo sapiens", organism_part: "corpus callosum" },
          })),
          sample_groups: [
            {
              group_name: "CC_Pool1",
              sample_count: 4,
              naming_prefix: "cc_pool1",
              metadata: { organism: "Homo sapiens", organism_part: "corpus callosum" },
              factor_values: [],
            },
            {
              group_name: "CC_Pool2",
              sample_count: 4,
              naming_prefix: "cc_pool2",
              metadata: { organism: "Homo sapiens", organism_part: "corpus callosum" },
              factor_values: [],
            },
          ],
          mapping_rows: mappingRows,
          relationship_layers: [
            { field: "biological_replicate", label: "Bio rep", role: "biological_replicate" },
            { field: "pool_id", label: "Pool", role: "aggregation" },
            { field: "label", label: "Label", role: "label_channel" },
            { field: "fraction_id", label: "Fraction", role: "preparation" },
            { field: "technical_replicate", label: "Tech rep", role: "technical_replicate" },
            { field: "assay_name", label: "Assay", role: "assay" },
            { field: "data_file", label: "Raw file", role: "data_file" },
          ],
          summary: "Two pools with different fraction counts.",
          sources: [],
        },
      },
    }));

    const { container } = renderBlueprintStep({ evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} });

    expect(screen.getByText("Current view: All relationships, showing 5 of 5 raw files.")).toBeTruthy();
    const initialGraph = within(container.querySelector(".blueprint-graph") as HTMLElement);
    expect(initialGraph.getAllByText("pool1_slice03.raw").length).toBeGreaterThan(0);
    expect(initialGraph.getAllByText("pool2_slice02.raw").length).toBeGreaterThan(0);

    const relationshipGroups = screen.getByLabelText("Relationship groups");
    expect(within(relationshipGroups).getByRole("button", { name: /^CC_Pool1$/i })).toBeTruthy();
    expect(within(relationshipGroups).getByRole("button", { name: /^CC_Pool2$/i })).toBeTruthy();

    await userEvent.click(within(relationshipGroups).getByRole("button", { name: /CC_Pool2/i }));

    expect(screen.getByText("Current view: CC_Pool2, showing 2 of 5 raw files.")).toBeTruthy();
    const groupFractionView = screen.getByLabelText("Group fraction view");
    expect(within(groupFractionView).getByRole("button", { name: /^F1$/i })).toBeTruthy();
    expect(within(groupFractionView).getByRole("button", { name: /^F2$/i })).toBeTruthy();
    expect(within(groupFractionView).queryByRole("button", { name: /^F3$/i })).toBeNull();

    await userEvent.click(within(groupFractionView).getByRole("button", { name: /^F2$/i }));

    expect(screen.getByText("Current view: CC_Pool2 / Fraction 2, showing 1 of 5 raw files.")).toBeTruthy();
    const updatedGraph = within(container.querySelector(".blueprint-graph") as HTMLElement);
    expect(updatedGraph.getAllByText("pool2_slice02.raw").length).toBeGreaterThan(0);
    expect(updatedGraph.queryByText("pool1_slice02.raw")).toBeNull();
    expect(updatedGraph.queryByText("pool1_slice03.raw")).toBeNull();
    expect(within(screen.getByLabelText("Current core mapping rows")).getByText("pool2_slice02.raw")).toBeTruthy();
  });

  it("repairs pooled fractionated rows when AI assigns every PXD000547-style raw file to the first pool", async () => {
    const subjects = [
      ["01", "CC_Pool1"],
      ["02", "CC_Pool1"],
      ["03", "CC_Pool1"],
      ["04", "CC_Pool1"],
      ["05", "CC_Pool2"],
      ["06", "CC_Pool2"],
      ["07", "CC_Pool2"],
      ["08", "CC_Pool2"],
    ];
    const mappingRows = Array.from({ length: 20 }, (_, index) => {
      const slice = String(index + 1).padStart(2, "0");
      return [1, 2].map((slot) => ({
        source_name: "CC_Pool1",
        biological_sample_id: "CC_Pool1",
        sample_group: "CC_Pool1",
        biological_replicate: "pool1_CC",
        pool_id: "pool1",
        pool_members: ["01", "02", "03", "04"],
        label: "label-free",
        preparation: "SDS-PAGE, in-gel trypsin",
        fraction_id: slice,
        acquisition_method: "DDA-top5",
        technical_replicate: String(slot),
        assay_name: "CC_Pool1",
        data_file: `dms_04Jul13_CC_Proteome_Slice${slice}_${String(slot).padStart(2, "0")}.RAW`,
      }));
    }).flat();
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          biological_samples: subjects.map(([sourceName, sampleGroup]) => ({
            source_name: sourceName,
            biological_sample_id: `subject_${sourceName}`,
            sample_group: sampleGroup,
            pool_id: sampleGroup.toLowerCase(),
            metadata: { organism: "Homo sapiens", organism_part: "corpus callosum" },
          })),
          sample_groups: [
            {
              group_name: "CC_Pool1",
              sample_count: 4,
              naming_prefix: "cc_pool1",
              metadata: { organism: "Homo sapiens", organism_part: "corpus callosum" },
              factor_values: [],
            },
            {
              group_name: "CC_Pool2",
              sample_count: 4,
              naming_prefix: "cc_pool2",
              metadata: { organism: "Homo sapiens", organism_part: "corpus callosum" },
              factor_values: [],
            },
          ],
          mapping_rows: mappingRows,
          relationship_layers: [
            { field: "biological_replicate", label: "Bio rep", role: "biological_replicate" },
            { field: "pool_id", label: "Pool", role: "aggregation" },
            { field: "label", label: "Label", role: "label_channel" },
            { field: "fraction_id", label: "Fraction", role: "preparation" },
            { field: "technical_replicate", label: "Tech rep", role: "technical_replicate" },
            { field: "assay_name", label: "Assay", role: "assay" },
            { field: "data_file", label: "Raw file", role: "data_file" },
          ],
          summary: "AI returned two pools but assigned all core rows to the first pool.",
          sources: [],
        },
      },
    }));

    renderBlueprintStep({ evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} });

    expect(screen.getByRole("button", { name: /CC_Pool1[\s\S]*20 mapping rows/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /CC_Pool2[\s\S]*20 mapping rows/i })).toBeTruthy();

    await userEvent.click(within(screen.getByLabelText("Sample groups")).getByRole("button", { name: /CC_Pool2[\s\S]*20 mapping rows/i }));

    const detail = screen.getByLabelText("Selected sample group details");
    for (const sample of ["05", "06", "07", "08"]) {
      expect(within(detail).getAllByText(sample).length).toBeGreaterThan(0);
    }
    const coreTable = screen.getByLabelText("Core SDRF relationship rows");
    expect(within(coreTable).getByText("Assay name")).toBeTruthy();
    expect(within(coreTable).queryByText("Assay/run")).toBeNull();
    expect(within(coreTable).getByText("dms_04Jul13_CC_Proteome_Slice01_02")).toBeTruthy();
    expect(within(detail).getAllByText("dms_04Jul13_CC_Proteome_Slice01_02.RAW").length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText("Current core mapping rows")).getByText("dms_04Jul13_CC_Proteome_Slice01_02.RAW")).toBeTruthy();
    expect(within(screen.getByLabelText("Current core mapping rows")).queryByText("dms_04Jul13_CC_Proteome_Slice01_01.RAW")).toBeNull();
  });

  it("fills missing AI mapping row raw files from imported PRIDE raw file evidence", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          sample_groups: [{
            group_name: "Plasmodium_falciparum_schizont",
            sample_count: 1,
            naming_prefix: "pfs",
            metadata: { organism: { value: "Plasmodium falciparum" } },
            factor_values: [],
            assay_context: { fractionation: "IMAC phosphopeptide enrichment" },
          }],
          mapping_rows: [{
            source_name: "pfs_01",
            biological_sample_id: "pfs_01",
            sample_group: "Plasmodium_falciparum_schizont",
            biological_replicate: "1",
            preparation: "IMAC phosphopeptide enrichment",
          }],
          summary: "PXD000070 sample draft.",
          sources: [],
        },
      },
    }));

    renderBlueprintStep({
      evidences: [{
        id: "sample-evidence-raw-files",
        source_type: "sample-evidence",
        source_ref: "generated",
        field: "sample evidence bundle",
        value: "raw_files=2",
        confidence: 0.9,
        payload: {
          raw_file_summary: {
            raw_file_names: [
              "PXD000070_Plasmodium_falciparum_schizont_IMAC_01.raw",
              "PXD000070_Plasmodium_falciparum_schizont_IMAC_02.raw",
            ],
            raw_file_count: 2,
          },
        },
        status: "accepted",
      }],
      questions: [],
      blueprint: { nodes: [], edges: [] },
      summary: {},
    });

    const detail = screen.getByLabelText("Selected sample group details");
    expect(within(detail).getAllByText("PXD000070_Plasmodium_falciparum_schizont_IMAC_01.raw").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("PXD000070_Plasmodium_falciparum_schizont_IMAC_02.raw").length).toBeGreaterThan(0);
  });

  it("keeps imported raw files when AI mapping rows only cover a subset of them", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          sample_groups: [{
            group_name: "Corpus Callosum",
            sample_count: 1,
            naming_prefix: "cc",
            metadata: { organismPart: { value: "corpus callosum" } },
            factor_values: [],
          }],
          mapping_rows: [
            {
              source_name: "cc_subject_01",
              biological_sample_id: "cc_subject_01",
              sample_group: "Corpus Callosum",
              biological_replicate: "1",
              fraction_id: "Slice01",
              technical_replicate: "1",
              assay_name: "assay_cc_01_01",
              data_file: "dms_04Jul13_CC_Proteome_Slice01_01.RAW",
            },
            {
              source_name: "cc_subject_01",
              biological_sample_id: "cc_subject_01",
              sample_group: "Corpus Callosum",
              biological_replicate: "1",
              fraction_id: "Slice01",
              technical_replicate: "2",
              assay_name: "assay_cc_01_02",
              data_file: "dms_04Jul13_CC_Proteome_Slice01_02.RAW",
            },
          ],
          relationship_layers: [
            { field: "biological_replicate", label: "Bio rep", role: "biological_replicate" },
            { field: "fraction_id", label: "Fraction", role: "preparation" },
            { field: "technical_replicate", label: "Tech rep", role: "technical_replicate" },
            { field: "assay_name", label: "Assay", role: "assay" },
            { field: "data_file", label: "Raw file", role: "data_file" },
          ],
          summary: "AI returned a partial core mapping.",
          sources: [],
        },
      },
    }));

    renderBlueprintStep({
      evidences: [{
        id: "sample-evidence-raw-files",
        source_type: "sample-evidence",
        source_ref: "generated",
        field: "sample evidence bundle",
        value: "raw_files=4",
        confidence: 0.9,
        payload: {
          raw_file_summary: {
            raw_file_names: [
              "dms_04Jul13_CC_Proteome_Slice01_01.RAW",
              "dms_04Jul13_CC_Proteome_Slice01_02.RAW",
              "dms_04Jul13_CC_Proteome_Slice02_01.RAW",
              "dms_04Jul13_CC_Proteome_Slice02_02.RAW",
            ],
            raw_file_count: 4,
          },
        },
        status: "accepted",
      }],
      questions: [],
      blueprint: { nodes: [], edges: [] },
      summary: {},
    });

    const detail = screen.getByLabelText("Selected sample group details");
    expect(within(detail).getAllByText("dms_04Jul13_CC_Proteome_Slice02_01.RAW").length).toBeGreaterThan(0);
    expect(within(detail).getAllByText("dms_04Jul13_CC_Proteome_Slice02_02.RAW").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
  });

  it("shows Samples AI grouping rationale and returned core mapping in the Blueprint assistant", () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      samples: {
        acceptedDraft: {
          sample_groups: [
            {
              group_name: "Control_Untreated",
              sample_count: 1,
              naming_prefix: "ctrl",
              metadata: { treatment: { value: "control" } },
              factor_values: ["factor value[treatment]"],
            },
            {
              group_name: "EGF_5min",
              sample_count: 1,
              naming_prefix: "egf5",
              metadata: { treatment: { value: "EGF" }, timePoint: { value: "5 min" } },
              factor_values: ["factor value[treatment]", "factor value[time point]"],
            },
          ],
          grouping_strategy: {
            selected_grouping_fields: ["treatment", "timepoint"],
            candidate_grouping_fields: [{
              field: "treatment",
              values: ["control", "EGF"],
              classification: "biological_factor",
              reason: "Treatment changes the biological condition before acquisition.",
            }],
            rejected_grouping_fields: [{
              field: "fraction",
              values: ["F1", "F2"],
              classification: "assay_file_variable",
              reason: "Fractions multiply files and should not split biological sample groups.",
            }],
            reason: "AI separated the study by treatment and timepoint because those are biological conditions.",
            sources: [{ label: "RAW file names", value: "control and EGF5 tokens", location: "Import > PRIDE files" }],
          },
          mapping_rows: [{
            source_name: "egf5_01",
            sample_group: "EGF_5min",
            biological_replicate: "BR1",
            fraction_id: "F2",
            assay_name: "assay_egf5_01",
            data_file: "egf5_01.raw",
          }],
          coverage_check: {
            warnings: ["All observed biological conditions are represented."],
          },
          summary: "AI returned two sample groups and one core mapping row.",
          sources: [{ label: "RAW file names", value: "egf5_01.raw", location: "Import > PRIDE files" }],
        },
      },
    }));

    renderBlueprintStep({ evidences: [], questions: [], blueprint: { nodes: [], edges: [] }, summary: {} });

    expect(screen.getByText("Samples AI core mapping draft")).toBeTruthy();
    expect(screen.getByText("AI returned two sample groups and one core mapping row.")).toBeTruthy();
    expect(screen.getByText("AI separated the study by treatment and timepoint because those are biological conditions.")).toBeTruthy();
    expect(screen.getByText("Selected: treatment, timepoint")).toBeTruthy();
    expect(screen.getByText(/Candidate: treatment/)).toBeTruthy();
    expect(screen.getByText(/Rejected: fraction/)).toBeTruthy();
    expect(screen.getByText("egf5_01 -> assay_egf5_01 -> egf5_01.raw")).toBeTruthy();
    expect(screen.queryByText("No AI draft is loaded yet. Run analysis to generate one.")).toBeNull();
  });
});

describe("SamplesStep", () => {
  afterEach(() => cleanup());
  afterEach(() => {
    window.localStorage.removeItem("sdrf-studio-ai-config");
    window.localStorage.removeItem("sdrf-studio-session-state:project-1");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not use uploaded SDRF rows for the sample attribute preview", () => {
    renderSamplesStep({
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "characteristics[organism]", "characteristics[disease]"],
        rows: [{ "source name": "legacy_01", "characteristics[organism]": "", "characteristics[disease]": "normal" }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    expect(screen.getByText("2 columns")).toBeTruthy();
    expect(screen.getByText("3 rows")).toBeTruthy();
    const previewPanel = screen.getByText("Sample attribute preview").closest("section");
    expect(previewPanel).toBeTruthy();
    expect(within(previewPanel as HTMLElement).getByRole("columnheader", { name: "source name" })).toBeTruthy();
    expect(within(previewPanel as HTMLElement).getByRole("columnheader", { name: "characteristics[biological replicate]" })).toBeTruthy();
    expect(within(previewPanel as HTMLElement).getByText("sample_01")).toBeTruthy();
    expect(screen.queryByText("legacy_01")).toBeNull();
    expect(within(previewPanel as HTMLElement).queryByRole("columnheader", { name: "characteristics[disease]" })).toBeNull();
    expect(within(previewPanel as HTMLElement).queryByRole("columnheader", { name: "characteristics[organism]" })).toBeNull();
  });

  it("builds the sample attribute preview from user-assigned attributes", async () => {
    renderSamplesStep({
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: [
          "source name",
          "characteristics[organism]",
          "characteristics[organism part]",
          "characteristics[disease]",
          "comment[data file]",
        ],
        rows: [{
          "source name": "legacy_01",
          "characteristics[organism]": "Homo sapiens",
          "characteristics[organism part]": "cervix",
          "characteristics[disease]": "normal",
          "comment[data file]": "legacy.raw",
        }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    const diseaseField = screen.getByTestId("sample-property-disease");
    await userEvent.type(within(diseaseField).getByLabelText(/Assignment value/i), "normal");
    await selectAllSamplesForField(diseaseField, "Disease");

    expect(screen.getByText("3 rows")).toBeTruthy();
    const previewPanel = screen.getByText("Sample attribute preview").closest("section");
    expect(previewPanel).toBeTruthy();
    expect(within(previewPanel as HTMLElement).getByRole("columnheader", { name: "source name" })).toBeTruthy();
    expect(within(previewPanel as HTMLElement).getByRole("columnheader", { name: "characteristics[disease]" })).toBeTruthy();
    expect(within(previewPanel as HTMLElement).getByText("sample_01")).toBeTruthy();
    expect(screen.queryByText("legacy_01")).toBeNull();
    expect(screen.queryByText("legacy.raw")).toBeNull();
    expect(within(previewPanel as HTMLElement).queryByRole("columnheader", { name: "characteristics[organism]" })).toBeNull();
    expect(within(previewPanel as HTMLElement).queryByRole("columnheader", { name: "characteristics[organism part]" })).toBeNull();
    expect(within(previewPanel as HTMLElement).queryByRole("columnheader", { name: "comment[data file]" })).toBeNull();
  });

  it("lets users batch-assign attribute values to samples and confirm detected factors", async () => {
    const putSdrfTable = vi.spyOn(api, "putSdrfTable").mockImplementation(async (_projectId, table) => table);
    renderSamplesStep();

    expect(screen.getByText("1. Number of biological samples")).toBeTruthy();
    expect(screen.getByText("2. Sample naming")).toBeTruthy();
    expect(screen.getByText("Attribute assignments")).toBeTruthy();
    expect(screen.getByText("Detected grouping variables")).toBeTruthy();

    await userEvent.clear(screen.getByLabelText("Sample count"));
    await userEvent.type(screen.getByLabelText("Sample count"), "4");

    const diseaseField = screen.getByTestId("sample-property-disease");
    await userEvent.type(within(diseaseField).getByLabelText(/Assignment value/i), "normal");
    expect(within(diseaseField).queryByRole("button", { name: /Assign sample_01 to Disease/i })).toBeNull();
    await selectSamplesForField(diseaseField, "Disease", ["sample_01", "sample_02"]);
    expect(within(diseaseField).getByText(/sample_01, sample_02/)).toBeTruthy();
    expect(within(diseaseField).queryByRole("button", { name: /Add Disease assignment/i })).toBeNull();

    await userEvent.type(within(diseaseField).getByLabelText(/Assignment value/i), "breast cancer");
    await selectSamplesForField(diseaseField, "Disease", ["sample_03", "sample_04"]);

    const diseaseFactor = screen.getByRole("checkbox", { name: /Use factor value\[disease\]/i }) as HTMLInputElement;
    expect(diseaseFactor.checked).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /Apply sample design/i }));

    expect(putSdrfTable).toHaveBeenCalledWith("project-1", expect.objectContaining({
      headers: expect.arrayContaining(["source name", "characteristics[disease]", "factor value[disease]"]),
      rows: expect.arrayContaining([
        expect.objectContaining({
          "source name": "sample_01",
          "characteristics[disease]": "normal",
          "factor value[disease]": "normal",
        }),
        expect.objectContaining({
          "source name": "sample_03",
          "characteristics[disease]": "breast cancer",
          "factor value[disease]": "breast cancer",
        }),
      ]),
    }));
  });

  it("renders all assigned sample names without truncating the assignment row", async () => {
    renderSamplesStep();

    await userEvent.clear(screen.getByLabelText("Sample count"));
    await userEvent.type(screen.getByLabelText("Sample count"), "12");

    const diseaseField = screen.getByTestId("sample-property-disease");
    await userEvent.type(within(diseaseField).getByLabelText(/Assignment value/i), "normal");
    await selectAllSamplesForField(diseaseField, "Disease");

    const assignedSamples = within(diseaseField).getByText(
      "sample_01, sample_02, sample_03, sample_04, sample_05, sample_06, sample_07, sample_08, sample_09, sample_10, sample_11, sample_12",
    );
    expect(assignedSamples.className).toContain("sample-assignment-samples");
  });

  it("hides samples already assigned within the same attribute while keeping them available for other attributes", async () => {
    renderSamplesStep();

    await userEvent.clear(screen.getByLabelText("Sample count"));
    await userEvent.type(screen.getByLabelText("Sample count"), "3");

    const organismField = screen.getByTestId("sample-property-organism");
    await userEvent.click(within(organismField).getByRole("button", { name: "Homo sapiens" }));
    await selectSamplesForField(organismField, "Organism", ["sample_01"]);

    await userEvent.click(within(organismField).getByRole("button", { name: "Mus musculus" }));
    await userEvent.click(within(organismField).getByRole("button", { name: "Select samples for Organism" }));
    expect(screen.getByRole("dialog", { name: "Select samples (Organism)" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "sample_01" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "sample_02" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const diseaseField = screen.getByTestId("sample-property-disease");
    await userEvent.type(within(diseaseField).getByLabelText(/Assignment value/i), "normal");
    await userEvent.click(within(diseaseField).getByRole("button", { name: "Select samples for Disease" }));
    expect(screen.getByRole("dialog", { name: "Select samples (Disease)" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "sample_01" })).toBeTruthy();
  });

  it("applies batch attribute assignments to generated SDRF rows", async () => {
    const putSdrfTable = vi.spyOn(api, "putSdrfTable").mockImplementation(async (_projectId, table) => table);
    renderSamplesStep();

    await userEvent.clear(screen.getByLabelText("Sample count"));
    await userEvent.type(screen.getByLabelText("Sample count"), "2");

    const organismField = screen.getByTestId("sample-property-organism");
    await userEvent.type(within(organismField).getByLabelText(/Assignment value/i), "Plasmodium falciparum");
    await selectAllSamplesForField(organismField, "Organism");

    const tissueField = screen.getByTestId("sample-property-organismPart");
    await userEvent.type(within(tissueField).getByLabelText(/Assignment value/i), "blood");
    await selectAllSamplesForField(tissueField, "Organism Part / Tissue");

    const diseaseField = screen.getByTestId("sample-property-disease");
    await userEvent.type(within(diseaseField).getByLabelText(/Assignment value/i), "malaria");
    await selectAllSamplesForField(diseaseField, "Disease");
    await userEvent.click(screen.getByRole("button", { name: /Apply sample design/i }));

    expect(await screen.findByText("Sample design applied to the SDRF table.")).toBeTruthy();
    expect(putSdrfTable).toHaveBeenCalledWith("project-1", expect.objectContaining({
      rows: expect.arrayContaining([
        expect.objectContaining({
          "source name": "sample_01",
          "characteristics[organism]": "Plasmodium falciparum",
          "characteristics[organism part]": "blood",
          "characteristics[disease]": "malaria",
          "characteristics[biological replicate]": "1",
        }),
        expect.objectContaining({ "source name": "sample_02", "characteristics[biological replicate]": "2" }),
      ]),
    }));
  });

  it("exposes batch sample metadata fields by requirement level", () => {
    renderSamplesStep();

    expect(screen.getByText("Sample design")).toBeTruthy();
    expect(screen.getByText("1. Number of biological samples")).toBeTruthy();
    expect(screen.getByText("2. Sample naming")).toBeTruthy();
    expect(screen.getByText("Attribute assignments")).toBeTruthy();
    expect(screen.getByText("Detected grouping variables")).toBeTruthy();
    expect(screen.getByLabelText("Sample count")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Auto-generate sample names" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Custom sample names" })).toBeTruthy();
    expect(screen.getByTestId("sample-property-pooledSample")).toBeTruthy();
    expect(within(screen.getByTestId("sample-property-pooledSample")).getByLabelText(/Assignment value for Pooled sample/i)).toBeTruthy();
    expect(screen.getByText("No grouping variables detected yet")).toBeTruthy();
  });

  it("does not render Core Mapping or canonical AI sample draft workflows", () => {
    renderSamplesStep();

    expect(screen.queryByLabelText("Core experiment mapping workflow")).toBeNull();
    expect(screen.queryByText(/^Core Mapping$/)).toBeNull();
    expect(screen.queryByRole("tab", { name: "Core Mapping Table" })).toBeNull();
    expect(screen.queryByLabelText("Canonical biological sample workflow")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Factor Review" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Canonical Sample Table" })).toBeNull();
  });

  it("updates the roster immediately from auto naming patterns", async () => {
    renderSamplesStep();

    await userEvent.clear(screen.getByLabelText("Sample count"));
    await userEvent.type(screen.getByLabelText("Sample count"), "5");

    expect(screen.getByText("sample_01, sample_02, sample_03, sample_04, sample_05")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Apply s01, s02" }));
    expect(screen.getByText("s01, s02, s03, s04, s05")).toBeTruthy();

    await userEvent.clear(screen.getByLabelText("Sample count"));
    await userEvent.type(screen.getByLabelText("Sample count"), "6");

    expect(screen.getByText("s01, s02, s03, s04, s05, s06")).toBeTruthy();
  });

  it("applies comma-separated custom sample names", async () => {
    renderSamplesStep();

    await userEvent.click(screen.getByRole("radio", { name: "Custom sample names" }));
    expect(screen.getByLabelText("Comma-separated sample names")).toBeTruthy();

    await userEvent.clear(screen.getByLabelText("Comma-separated sample names"));
    await userEvent.type(screen.getByLabelText("Comma-separated sample names"), "donor_A, donor_B, donor_C");
    await userEvent.click(screen.getByRole("button", { name: "Apply custom sample names" }));

    expect(screen.getByText("donor_A, donor_B, donor_C")).toBeTruthy();
    expect((screen.getByLabelText("Sample count") as HTMLInputElement).value).toBe("3");
  });

  it("uses primary treatment for applying custom sample names while sample selection stays secondary", async () => {
    renderSamplesStep();

    await userEvent.click(screen.getByRole("radio", { name: "Custom sample names" }));
    const generateButton = screen.getByRole("button", { name: "Apply custom sample names" });
    const organismField = screen.getByTestId("sample-property-organism");
    const selectSamplesButton = within(organismField).getByRole("button", { name: "Select samples for Organism" });

    expect(generateButton.className).toContain("btn primary");
    expect(selectSamplesButton.className).toContain("btn ghost");
  });

  it("places the sample picker beside the assignment value input", () => {
    renderSamplesStep();

    const diseaseField = screen.getByTestId("sample-property-disease");
    const valueSelectionRow = diseaseField.querySelector(".sample-value-selection-row");

    expect(valueSelectionRow).toBeTruthy();
    expect(valueSelectionRow?.querySelector('[aria-label="Assignment value for Disease"]')).toBeTruthy();
    expect(within(valueSelectionRow as HTMLElement).getByRole("button", { name: "Select samples for Disease" })).toBeTruthy();
    expect(within(diseaseField).queryByRole("button", { name: /Add Disease assignment/i })).toBeNull();
  });

  it("renders ontology metadata fields as searchable property controls with common choices", async () => {
    renderSamplesStep();

    const organismField = screen.getByTestId("sample-property-organism");
    expect(within(organismField).getByText("Organism")).toBeTruthy();
    expect(within(organismField).getByText("*")).toBeTruthy();
    expect(within(organismField).getByText("?")).toBeTruthy();
    expect(within(organismField).getByText("Species of your samples (e.g., Homo sapiens, Mus musculus)")).toBeTruthy();
    expect(within(organismField).getByPlaceholderText("Search for organism...")).toBeTruthy();
    expect(within(organismField).getByRole("button", { name: "Homo sapiens" })).toBeTruthy();
    expect(within(organismField).getByRole("button", { name: "Mus musculus" })).toBeTruthy();

    await userEvent.type(within(organismField).getByPlaceholderText("Search for organism..."), "homo sapiens");
    await userEvent.click(within(organismField).getByRole("button", { name: /Homo sapiens NCBITaxon:9606/i }));
    expect(organismField.querySelector(".sample-selected-term")).toBeNull();
    expect(within(organismField).queryByRole("button", { name: "Remove Organism" })).toBeNull();

    await selectAllSamplesForField(organismField, "Organism");

    const assignmentValue = organismField.querySelector(".sample-assignment-value");
    expect(assignmentValue?.textContent).toContain("Homo sapiens");
    expect(assignmentValue?.textContent).toContain("(NCBITaxon:9606)");
    expect(within(organismField).getByText(/sample_01, sample_02, sample_03/)).toBeTruthy();
  });

  it("uses EBI OLS suggestions for sample ontology assignment fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          numFound: 1,
          docs: [{
            iri: "http://purl.obolibrary.org/obo/NCBITaxon_741158",
            short_form: "NCBITaxon_741158",
            obo_id: "NCBITaxon:741158",
            label: "Homo sapiens subsp. 'Denisova'",
            ontology_prefix: "ncbitaxon",
            description: ["Denisovan human taxon"],
            synonym: [],
          }],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({});
    renderSamplesStep();

    const organismField = screen.getByTestId("sample-property-organism");
    await userEvent.type(within(organismField).getByPlaceholderText("Search for organism..."), "denisova");

    const remoteSuggestion = await within(organismField).findByRole("button", { name: /Homo sapiens subsp\. 'Denisova' NCBITaxon:741158/i });
    const requestUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestUrl).toContain("https://www.ebi.ac.uk/ols4/api/select");
    expect(requestUrl).toContain("ontology=ncbitaxon");

    await userEvent.click(remoteSuggestion);
    await selectAllSamplesForField(organismField, "Organism");

    const assignmentValue = organismField.querySelector(".sample-assignment-value");
    expect(assignmentValue?.textContent).toContain("Homo sapiens subsp. 'Denisova'");
    expect(assignmentValue?.textContent).toContain("(NCBITaxon:741158)");
  });

  it("keeps ontology property controls focused on user-facing labels instead of SDRF column names", () => {
    renderSamplesStep();

    expect(within(screen.getByTestId("sample-property-organism")).queryByText("characteristics[organism]")).toBeNull();
  });

  it("renders requirement groups as cards and uses the same property control shape for every field", () => {
    renderSamplesStep();

    const requiredCard = screen.getByTestId("sample-metadata-required");
    const recommendedCard = screen.getByTestId("sample-metadata-recommended");
    const optionalCard = screen.getByTestId("sample-metadata-optional");

    expect(requiredCard.className).toContain("sample-field-section-card");
    expect(recommendedCard.className).toContain("sample-field-section-card");
    expect(optionalCard.className).toContain("sample-field-section-card");
    expect(within(optionalCard).getByTestId("sample-property-pooledSample")).toBeTruthy();
    expect(within(optionalCard).getByTestId("sample-property-treatment")).toBeTruthy();
    expect(recommendedCard.querySelector(".sample-field")).toBeNull();
    expect(optionalCard.querySelector(".sample-field")).toBeNull();
  });

  it("loads sample properties from the selected template stack instead of the static context field list", () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      templates: { selectedTemplates: ["ms-proteomics", "human", "clinical-metadata", "oncology-metadata"] },
    }));

    renderSamplesStep();

    expect((screen.getByLabelText("Sample context") as HTMLSelectElement).disabled).toBe(true);
    expect(within(screen.getByTestId("sample-metadata-required")).getByTestId("sample-property-organism")).toBeTruthy();
    expect(within(screen.getByTestId("sample-metadata-required")).getByTestId("sample-property-disease")).toBeTruthy();
    expect(within(screen.getByTestId("sample-metadata-required")).getByTestId("sample-property-age")).toBeTruthy();
    expect(within(screen.getByTestId("sample-metadata-optional")).getByTestId("sample-property-bodyMassIndex")).toBeTruthy();
    expect(within(screen.getByTestId("sample-metadata-optional")).getByTestId("sample-property-tumorStage")).toBeTruthy();
    expect(within(screen.getByTestId("sample-metadata-optional")).getByTestId("sample-property-pooledSample")).toBeTruthy();
    expect(screen.queryByTestId("sample-property-biosampleAccession")).toBeNull();
  });

  it("inherits shared sample-metadata fields from upstream ms-proteomics templates", () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      templates: { selectedTemplates: ["ms-proteomics"] },
    }));

    renderSamplesStep();

    expect(screen.getByTestId("sample-property-tissueSupergroup")).toBeTruthy();
    expect(screen.getByTestId("sample-property-tissueMass")).toBeTruthy();
    expect(screen.getByTestId("sample-property-biosampleAccessionNumber")).toBeTruthy();
    expect(screen.getByTestId("sample-property-depletion")).toBeTruthy();
    expect(screen.queryByTestId("sample-property-age")).toBeNull();
  });

  it("uses upstream requirement overrides and clinical oncology fields", () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      templates: { selectedTemplates: ["ms-proteomics", "human", "clinical-metadata", "oncology-metadata"] },
    }));

    renderSamplesStep();

    const requiredCard = screen.getByTestId("sample-metadata-required");
    const optionalCard = screen.getByTestId("sample-metadata-optional");
    expect(within(requiredCard).getByTestId("sample-property-age")).toBeTruthy();
    expect(within(requiredCard).getByTestId("sample-property-sex")).toBeTruthy();
    expect(within(optionalCard).getByTestId("sample-property-compound")).toBeTruthy();
    expect(within(optionalCard).getByTestId("sample-property-dose")).toBeTruthy();
    expect(within(optionalCard).getByTestId("sample-property-diseaseStaging")).toBeTruthy();
  });

  it("starts custom factor source empty without rendering the add button", () => {
    renderSamplesStep();

    const customFactorSource = screen.getByLabelText("Custom factor source") as HTMLSelectElement;

    expect(customFactorSource.value).toBe("");
    expect(within(customFactorSource).getByRole("option", { name: "Select attribute..." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add custom factor/i })).toBeNull();
  });

  it("respects upstream metaproteomics exclusions when soil is combined with ms-proteomics", () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      templates: { selectedTemplates: ["ms-proteomics", "soil"] },
    }));

    renderSamplesStep();

    expect(screen.getByTestId("sample-property-environmentalSampleType")).toBeTruthy();
    expect(screen.getByTestId("sample-property-soilType")).toBeTruthy();
    expect(screen.queryByTestId("sample-property-organism")).toBeNull();
    expect(screen.queryByTestId("sample-property-disease")).toBeNull();
    expect(screen.queryByTestId("sample-property-pooledSample")).toBeNull();
  });

  it("parses AI sample JSON and accepts it into the left-side attribute editor", async () => {
    const putSdrfTable = vi.spyOn(api, "putSdrfTable").mockImplementation(async (_projectId, table) => table);
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              sample_groups: [{
                group_name: "Control",
                sample_count: 2,
                naming_prefix: "CTRL",
                metadata: {
                  organism: "Homo sapiens",
                  organismPart: "plasma",
                  disease: "normal",
                },
              }],
              summary: "Control plasma samples detected.",
              sources: [{ label: "Organism", value: "Homo sapiens", location: "Import > PRIDE metadata" }],
            }),
          },
        }],
      }),
    }));
    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    const aiSummary = await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement;
    expect(aiSummary.value).toBe("Control plasma samples detected.");
    await userEvent.click(screen.getByRole("button", { name: /Accept/i }));

    expect(await screen.findByText("AI JSON filled into the left-side sample attributes. Review the assignments, then apply sample design.")).toBeTruthy();
    expect(putSdrfTable).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Custom sample names" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("Comma-separated sample names") as HTMLInputElement).value).toBe("ctrl_01, ctrl_02");
    expect(within(screen.getByTestId("sample-property-organism")).getByText("ctrl_01, ctrl_02")).toBeTruthy();
    expect(within(screen.getByTestId("sample-property-disease")).getByText("ctrl_01, ctrl_02")).toBeTruthy();
  });

  it("does not offer the AI groups canonical draft handoff", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              schema_version: "sdrf-sample-design-v1",
              grouping_strategy: {
                selected_grouping_fields: ["treatment", "time point"],
                candidate_grouping_fields: [
                  { field: "treatment", values: ["vehicle", "EGF"], reason: "Treatment separates the biological comparison." },
                  { field: "time point", values: ["0 min", "15 min"], reason: "Time point separates the biological comparison." },
                  { field: "fraction", values: ["F1", "F2"], reason: "Fractions come from file-level preparation." },
                ],
                rejected_grouping_fields: [
                  { field: "fraction", values: ["F1", "F2"], reason: "Fraction is not a biological sample factor." },
                ],
                reason: "The paper describes a treatment by time course experiment.",
              },
              sample_groups: [
                {
                  group_name: "Vehicle 0 min",
                  sample_count: 2,
                  naming_prefix: "CTRL0",
                  metadata: {
                    organism: "Homo sapiens",
                    organism_part: "cell culture",
                    disease: "not available",
                    treatment: "vehicle",
                    time_point: "0 min",
                  },
                  factor_values: ["factor value[treatment]", "factor value[time point]"],
                  assay_context: { fractions: ["F1", "F2"], raw_file_count: 12 },
                },
                {
                  group_name: "EGF 15 min",
                  sample_count: 3,
                  naming_prefix: "EGF15",
                  metadata: {
                    organism: "Homo sapiens",
                    organism_part: "cell culture",
                    disease: "not available",
                    treatment: "EGF",
                    time_point: "15 min",
                  },
                  factor_values: ["factor value[treatment]", "factor value[time point]"],
                  assay_context: { fractions: ["F1", "F2"], raw_file_count: 18 },
                },
              ],
              summary: "EGF treatment time course with five biological samples.",
              sources: [{ label: "PDF", value: "EGF treatment for 15 minutes", location: "publication methods" }],
            }),
          },
        }],
      }),
    }));
    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    expect((await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement).value).toBe("EGF treatment time course with five biological samples.");

    expect(screen.queryByRole("button", { name: /Use AI groups as sample draft/i })).toBeNull();
    expect(screen.queryByLabelText("Canonical biological sample workflow")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Factor Review" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Canonical Sample Table" })).toBeNull();
  });

  it("warns when AI sample groups miss biological conditions observed in raw filenames", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              schema_version: "sdrf-sample-design-v2",
              grouping_strategy: {
                selected_grouping_fields: ["treatment", "time point"],
                candidate_grouping_fields: [
                  { field: "treatment", values: ["untreated control", "EGF"], classification: "biological_factor", reason: "AI-selected treatment axis." },
                  { field: "time point", values: ["0 min"], classification: "biological_factor", reason: "AI-selected time axis." },
                ],
                rejected_grouping_fields: [
                  { field: "preparation", values: ["Proteome", "Phospho", "pY"], classification: "assay_file_variable", reason: "Preparation is assay context." },
                ],
                reason: "AI compressed the design into two groups.",
              },
              sample_groups: [
                {
                  group_name: "Control",
                  sample_count: 3,
                  naming_prefix: "CTRL",
                  metadata: {
                    organism: "Homo sapiens",
                    organism_part: "cell culture",
                    disease: "not available",
                    treatment: "untreated control",
                    time_point: "not available",
                  },
                  factor_values: ["factor value[treatment]", "factor value[time point]"],
                },
                {
                  group_name: "EGF 0 min",
                  sample_count: 3,
                  naming_prefix: "EGF0",
                  metadata: {
                    organism: "Homo sapiens",
                    organism_part: "cell culture",
                    disease: "not available",
                    treatment: "EGF",
                    time_point: "0 min",
                  },
                  factor_values: ["factor value[treatment]", "factor value[time point]"],
                },
              ],
              coverage_check: {
                missing_biological_conditions: ["EGF 5 min", "EGF 15 min", "Nocodazole", "Pervanadate"],
                warnings: ["AI coverage check found biological conditions missing from sample_groups."],
              },
              summary: "Compressed control and EGF draft.",
              sources: [{ label: "AI", value: "draft", location: "test" }],
            }),
          },
        }],
      }),
    }));

    renderSamplesStep({
      analysis: {
        evidences: [{
          id: "sample-evidence-1",
          source_type: "sample-evidence",
          source_ref: "generated",
          field: "sample evidence bundle",
          value: "raw_files=12",
          confidence: 0.9,
          payload: {
            raw_file_summary: {
              raw_file_count: 12,
              raw_file_names: [
                "HeLa_Proteome_Control_rep1_pH1.raw",
                "HeLa_Proteome_EGF5_rep1_pH1.raw",
                "HeLa_Proteome_EGF15_rep1_pH1.raw",
                "HeLa_Proteome_Nocodazole_rep1_pH1.raw",
                "HeLa_Proteome_PV_rep1_pH1.raw",
              ],
              semantic_parsing: "disabled",
            },
          },
          status: "accepted",
        }],
        questions: [],
        blueprint: { nodes: [], edges: [] },
        summary: {},
      },
    });

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));

    expect((await screen.findAllByText(/AI coverage check found biological conditions missing from sample_groups/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI coverage_check reports missing biological condition: EGF 5 min/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI coverage_check reports missing biological condition: EGF 15 min/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI coverage_check reports missing biological condition: Nocodazole/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AI coverage_check reports missing biological condition: Pervanadate/i).length).toBeGreaterThan(0);
  });

  it("saves the assembled sample AI request before sending it to the AI provider", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    const savePrompt = vi.spyOn(api, "saveSampleAiPrompt").mockResolvedValue({
      status: "saved",
      filename: "sample-ai-prompt.json",
      path: "storage/project-1/debug/sample-ai-prompts/sample-ai-prompt.json",
    });
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              sample_groups: [],
              summary: "Prompt debug test draft.",
              sources: [],
            }),
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({});
    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    expect((await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement).value).toBe("Prompt debug test draft.");

    expect(savePrompt).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(savePrompt.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    const savedPayload = savePrompt.mock.calls[0][1] as {
      model: string;
      messages: Array<{ content: string }>;
    };
    const aiPayload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(savePrompt).toHaveBeenCalledWith("project-1", aiPayload);
    expect(savedPayload.model).toBe("test-model");
    expect(savedPayload.messages[0].content).toContain("sdrf-core-mapping-v1");
    expect(JSON.stringify(savedPayload)).not.toContain("test-key");
  });

  it("keeps the sample AI loading card when the Samples step remounts mid-request", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    let resolveFetch: (response: { ok: boolean; json: () => Promise<unknown> }) => void = () => undefined;
    const fetchPromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => fetchPromise));
    const client = createTestQueryClient();
    const view = renderSamplesStep({}, client);

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    expect(await screen.findByText("AI is reading import context")).toBeTruthy();
    view.unmount();

    renderSamplesStep({}, client);

    expect(await screen.findByText("AI is reading import context")).toBeTruthy();
    expect(screen.getByText("Generating sample JSON...")).toBeTruthy();

    resolveFetch({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              sample_groups: [],
              summary: "Sample AI finished after remount.",
              sources: [],
            }),
          },
        }],
      }),
    });

    const aiSummary = await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement;
    expect(aiSummary.value).toBe("Sample AI finished after remount.");
    const session = JSON.parse(window.localStorage.getItem("sdrf-studio-session-state:project-1") ?? "{}");
    expect(session.samples.aiStatus).toBe("success");
    expect(session.samples.aiDraft.summary).toBe("Sample AI finished after remount.");
  });

  it("renders editable AI sample JSON and fills the left-side attributes", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              schema_version: "sdrf-sample-design-v1",
              sample_groups: [{
                group_name: "Control",
                sample_count: 2,
                naming_prefix: "CTRL",
                metadata: {
                  organism: {
                    value: "Homo sapiens",
                    reason: "PRIDE metadata lists Homo sapiens as the organism.",
                    sources: [{ label: "Organism", value: "Homo sapiens", location: "Import > PRIDE metadata" }],
                  },
                  organismPart: {
                    value: "plasma",
                    reason: "The design table preview contains plasma samples.",
                    sources: [{ label: "Organism part", value: "plasma", location: "design table > tissue" }],
                  },
                  disease: {
                    value: "normal",
                    reason: "Control samples are described as healthy controls.",
                    sources: [{ label: "Disease", value: "healthy control", location: "design table > condition" }],
                    confidence: 0.91,
                  },
                },
                factor_values: ["factor value[disease]"],
              }],
              mapping_rows: [{
                source_name: "ctrl_01",
                sample_group: "Control",
                biological_replicate: "BR1",
                assay_name: "assay_ctrl_01",
                data_file: "ctrl_01.raw",
              }],
              summary: "Control plasma samples detected.",
              sources: [{ label: "Organism", value: "Homo sapiens", location: "Import > PRIDE metadata" }],
            }),
          },
        }],
      }),
    }));
    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    await screen.findByText("Editable JSON draft");
    await waitFor(() => {
      const currentDiseaseEditor = screen.getByLabelText("AI group 1 Disease").closest(".sample-json-field-editor") as HTMLElement;
      expect((within(currentDiseaseEditor).getByRole("button", { name: /Source/i }) as HTMLButtonElement).disabled).toBe(false);
    });
    const diseaseEditor = screen.getByLabelText("AI group 1 Disease").closest(".sample-json-field-editor") as HTMLElement;
    const diseaseSourceButton = within(diseaseEditor).getByRole("button", { name: /Source/i }) as HTMLButtonElement;
    await userEvent.click(diseaseSourceButton);
    expect(await screen.findByText("Control samples are described as healthy controls.")).toBeTruthy();
    expect(screen.getByText("design table > condition")).toBeTruthy();
    const diseaseInput = screen.getByLabelText("AI group 1 Disease");
    fireEvent.change(diseaseInput, { target: { value: "treated" } });
    expect((screen.getByLabelText("AI group 1 Disease") as HTMLInputElement).value).toBe("treated");
    expect((within(diseaseEditor).getByRole("button", { name: /Source/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Fill attributes/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Accept/i }));

    expect(await screen.findByText("AI JSON filled into the left-side sample attributes. Review the assignments, then apply sample design.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Custom sample names" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("Comma-separated sample names") as HTMLInputElement).value).toBe("ctrl_01, ctrl_02");
    expect(screen.getAllByText("ctrl_01, ctrl_02").length).toBeGreaterThan(0);
    const diseaseField = screen.getByTestId("sample-property-disease");
    expect(within(diseaseField).getByText("treated")).toBeTruthy();
    expect(within(diseaseField).getByText("ctrl_01, ctrl_02")).toBeTruthy();
    const session = JSON.parse(window.localStorage.getItem("sdrf-studio-session-state:project-1") ?? "{}");
    expect(session.samples.acceptedDraft.sample_groups[0].group_name).toBe("Control");
    expect(session.samples.acceptedDraft.sample_groups[0].metadata.disease.value).toBe("treated");
    expect(session.samples.acceptedDraft.mapping_rows[0]).toEqual(expect.objectContaining({
      source_name: "ctrl_01",
      assay_name: "assay_ctrl_01",
      data_file: "ctrl_01.raw",
    }));
  });

  it("uses source-level biological_samples for Samples attributes when AI also returns pooled sample groups", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      templates: { selectedTemplates: ["ms-proteomics", "human"] },
    }));
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              schema_version: "sdrf-core-mapping-v1",
              biological_samples: [
                { source_name: "subject_01", sample_group: "Corpus Callosum", biological_replicate: "1", pool_id: "pool_cc_br1", metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "cardiopulmonary insufficiency", age: "41Y", sex: "female", individual: "subject_01" } },
                { source_name: "subject_02", sample_group: "Corpus Callosum", biological_replicate: "2", pool_id: "pool_cc_br1", metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "cardiopulmonary insufficiency", age: "91Y", sex: "female", individual: "subject_02" } },
                { source_name: "subject_03", sample_group: "Corpus Callosum", biological_replicate: "3", pool_id: "pool_cc_br1", metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "lung embolism", age: "69Y", sex: "female", individual: "subject_03" } },
                { source_name: "subject_04", sample_group: "Corpus Callosum", biological_replicate: "4", pool_id: "pool_cc_br1", metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "heart infarction", age: "57Y", sex: "male", individual: "subject_04" } },
                { source_name: "subject_05", sample_group: "Corpus Callosum", biological_replicate: "5", pool_id: "pool_cc_br2", metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "heart infarction", age: "53Y", sex: "male", individual: "subject_05" } },
                { source_name: "subject_06", sample_group: "Corpus Callosum", biological_replicate: "6", pool_id: "pool_cc_br2", metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "heart infarction", age: "63Y", sex: "male", individual: "subject_06" } },
                { source_name: "subject_07", sample_group: "Corpus Callosum", biological_replicate: "7", pool_id: "pool_cc_br2", metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "heart infarction", age: "66Y", sex: "male", individual: "subject_07" } },
                { source_name: "subject_08", sample_group: "Corpus Callosum", biological_replicate: "8", pool_id: "pool_cc_br2", metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "heart infarction", age: "79Y", sex: "male", individual: "subject_08" } },
              ],
              pools: [
                { pool_id: "pool_cc_br1", member_source_names: ["subject_01", "subject_02", "subject_03", "subject_04"] },
                { pool_id: "pool_cc_br2", member_source_names: ["subject_05", "subject_06", "subject_07", "subject_08"] },
              ],
              sample_groups: [
                { group_name: "CC_BioRep1", sample_count: 1, naming_prefix: "pool_cc_br1", metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "not available" } },
                { group_name: "CC_BioRep2", sample_count: 1, naming_prefix: "pool_cc_br2", metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "not available" } },
              ],
              mapping_rows: [
                { source_name: "pool_cc_br1", pool_id: "pool_cc_br1", pool_members: ["subject_01", "subject_02", "subject_03", "subject_04"], assay_name: "cc_pool_1_slice_01", data_file: "dms_04Jul13_CC_Proteome_Slice01_01.RAW" },
                { source_name: "pool_cc_br2", pool_id: "pool_cc_br2", pool_members: ["subject_05", "subject_06", "subject_07", "subject_08"], assay_name: "cc_pool_2_slice_01", data_file: "dms_04Jul13_CC_Proteome_Slice01_02.RAW" },
              ],
              summary: "Eight source-level subjects are split into two CC pools.",
              sources: [{ label: "PDF Table 1", value: "subject age gender cause of death table", location: "page 2" }],
            }),
          },
        }],
      }),
    }));
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({});

    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    expect((await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement).value).toBe("Eight source-level subjects are split into two CC pools.");
    const firstGroupSamples = screen.getByLabelText("AI group 1 source-level biological samples");
    expect(within(firstGroupSamples).getAllByText("subject_01").length).toBeGreaterThan(0);
    expect(within(firstGroupSamples).getByText("41Y")).toBeTruthy();
    expect(within(firstGroupSamples).getAllByText("cardiopulmonary insufficiency").length).toBeGreaterThan(0);
    const secondGroupSamples = screen.getByLabelText("AI group 2 source-level biological samples");
    expect(within(secondGroupSamples).getAllByText("subject_08").length).toBeGreaterThan(0);
    expect(within(secondGroupSamples).getByText("79Y")).toBeTruthy();
    expect(within(secondGroupSamples).getAllByText("heart infarction").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /Accept/i }));

    expect(await screen.findByText("8 rows")).toBeTruthy();
    expect((screen.getByLabelText("Comma-separated sample names") as HTMLInputElement).value).toBe(
      "subject_01, subject_02, subject_03, subject_04, subject_05, subject_06, subject_07, subject_08",
    );
    expect(within(screen.getByTestId("sample-property-age")).getByText("41Y")).toBeTruthy();
    expect(within(screen.getByTestId("sample-property-age")).getByText("subject_01")).toBeTruthy();
    expect(within(screen.getByTestId("sample-property-age")).getByText("91Y")).toBeTruthy();
    expect(within(screen.getByTestId("sample-property-disease")).getByText("lung embolism")).toBeTruthy();
    expect(within(screen.getByTestId("sample-property-sex")).getAllByText("male").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("sample-property-individual")).getAllByText("subject_08").length).toBeGreaterThan(0);
  });

  it("expands AI Assistant source-level preview when one returned biological sample summarizes a larger group", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              schema_version: "sdrf-core-mapping-v1",
              biological_samples: [{
                source_name: "Control_Asynchronous",
                sample_group: "Control_Asynchronous",
                biological_replicate: "1",
                metadata: {
                  organism: "Homo sapiens",
                  organism_part: "cell culture",
                  disease: "cervical adenocarcinoma",
                  material_type: "cell line",
                  sex: "female",
                  cell_line: "HeLa S3",
                  cellosaurus_accession: "CVCL_0058",
                  culture_medium: "RPMI 1640",
                },
              }],
              sample_groups: [{
                group_name: "Control_Asynchronous",
                sample_count: 6,
                naming_prefix: "hela_s3_asynch",
                metadata: {
                  organism: "Homo sapiens",
                  organism_part: "cell culture",
                  disease: "cervical adenocarcinoma",
                  material_type: "cell line",
                  sex: "female",
                  cell_line: "HeLa S3",
                  cellosaurus_accession: "CVCL_0058",
                  culture_medium: "RPMI 1640",
                },
                factor_values: ["factor value[treatment]"],
                assay_context: { fractionated: true, workflows: ["Proteome", "Phospho", "pY"] },
              }],
              mapping_rows: [],
              summary: "Control asynchronous group has six biological replicates.",
              sources: [],
            }),
          },
        }],
      }),
    }));
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({});

    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    expect((await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement).value).toBe("Control asynchronous group has six biological replicates.");
    const groupSamples = screen.getByLabelText("AI group 1 source-level biological samples");
    expect(groupSamples.textContent).toContain("6 samples");
    expect(within(groupSamples).getByText("hela_s3_asynch_01")).toBeTruthy();
    expect(within(groupSamples).getByText("hela_s3_asynch_06")).toBeTruthy();
    expect(within(groupSamples).getAllByText("cervical adenocarcinoma").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /Accept/i }));

    expect(await screen.findByText("6 rows")).toBeTruthy();
    expect((screen.getByLabelText("Comma-separated sample names") as HTMLInputElement).value).toBe(
      "hela_s3_asynch_01, hela_s3_asynch_02, hela_s3_asynch_03, hela_s3_asynch_04, hela_s3_asynch_05, hela_s3_asynch_06",
    );
  });

  it("keeps Samples visible when accepting a PXD000547-style pooled biological sample draft", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      templates: { selectedTemplates: ["ms-proteomics", "human"] },
    }));
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    const subjects = [
      ["01", "41", "F", "cardiopulmonary insufficiency", "pool_cc_br1"],
      ["02", "91", "F", "cardiopulmonary insufficiency", "pool_cc_br1"],
      ["03", "69", "F", "lung embolism", "pool_cc_br1"],
      ["04", "57", "M", "heart infarction", "pool_cc_br1"],
      ["05", "53", "M", "heart infarction", "pool_cc_br2"],
      ["06", "63", "M", "heart infarction", "pool_cc_br2"],
      ["07", "66", "M", "heart infarction", "pool_cc_br2"],
      ["08", "79", "M", "heart infarction", "pool_cc_br2"],
    ];
    const rawFiles = Array.from({ length: 20 }, (_, index) => {
      const slice = String(index + 1).padStart(2, "0");
      return [
        `dms_04Jul13_CC_Proteome_Slice${slice}_01.RAW`,
        `dms_04Jul13_CC_Proteome_Slice${slice}_02.RAW`,
      ];
    }).flat();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              schema_version: "sdrf-core-mapping-v1",
              biological_samples: subjects.map(([id, age, sex, disease, poolId]) => ({
                source_name: id,
                biological_sample_id: `subject_${id}`,
                sample_group: "Corpus Callosum",
                biological_replicate: id,
                pool_id: poolId,
                metadata: {
                  organism: "Homo sapiens",
                  organism_part: "corpus callosum",
                  disease,
                  age,
                  sex,
                  individual: id,
                },
              })),
              pools: [
                { pool_id: "pool_cc_br1", member_source_names: ["01", "02", "03", "04"] },
                { pool_id: "pool_cc_br2", member_source_names: ["05", "06", "07", "08"] },
              ],
              sample_groups: [
                {
                  group_name: "CC_BioRep1",
                  sample_count: 4,
                  naming_prefix: "cc_br1",
                  metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "not available", age: "not available", sex: "not available" },
                  factor_values: [],
                },
                {
                  group_name: "CC_BioRep2",
                  sample_count: 4,
                  naming_prefix: "cc_br2",
                  metadata: { organism: "Homo sapiens", organism_part: "corpus callosum", disease: "not available", age: "not available", sex: "not available" },
                  factor_values: [],
                },
              ],
              mapping_rows: rawFiles.map((dataFile) => {
                const poolIndex = dataFile.includes("_01.RAW") ? 1 : 2;
                const poolId = poolIndex === 1 ? "pool_cc_br1" : "pool_cc_br2";
                return {
                  source_name: poolId,
                  biological_sample_id: poolId,
                  sample_group: "Corpus Callosum",
                  biological_replicate: String(poolIndex),
                  pool_id: poolId,
                  pool_members: poolIndex === 1 ? ["01", "02", "03", "04"] : ["05", "06", "07", "08"],
                  label: "label free sample",
                  fraction_id: dataFile.match(/Slice(\d+)/)?.[1] ?? "not available",
                  technical_replicate: "1",
                  assay_name: dataFile.replace(/\.RAW$/i, ""),
                  data_file: dataFile,
                };
              }),
              summary: "Eight source-level subjects are represented in two corpus callosum pools with 20 fractions each.",
              sources: [{ label: "PDF Table 1", value: "8 subjects and two pools", location: "page 2" }],
            }),
          },
        }],
      }),
    }));
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({});

    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    expect((await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement).value).toContain("Eight source-level subjects");
    await userEvent.click(screen.getByRole("button", { name: /Accept/i }));

    expect(await screen.findByText("8 rows")).toBeTruthy();
    expect(screen.getByText("Sample attribute preview")).toBeTruthy();
    expect((screen.getByLabelText("Comma-separated sample names") as HTMLInputElement).value).toBe("01, 02, 03, 04, 05, 06, 07, 08");
    expect(within(screen.getByTestId("sample-property-sex")).getAllByText("male").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("sample-property-disease")).getAllByText("heart infarction").length).toBeGreaterThan(0);
  });

  it("keeps the Samples page usable when accepting an AI draft cannot be persisted", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(this: Storage, key: string, value: string) {
      if (key === "sdrf-studio-session-state:project-1" && value.includes("\"acceptedDraft\"")) {
        throw new Error("localStorage quota exceeded");
      }
      return originalSetItem.call(this, key, value);
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              schema_version: "sdrf-sample-design-v2",
              sample_groups: [{
                group_name: "Corpus callosum",
                sample_count: 2,
                naming_prefix: "CC_Subject",
                metadata: {
                  organism: { value: "Homo sapiens", reason: "Publication reports human samples." },
                  organism_part: { value: "corpus callosum", reason: "Publication reports corpus callosum tissue." },
                  disease: { value: "normal", reason: "No disease grouping is described." },
                },
                factor_values: [],
              }],
              mapping_rows: Array.from({ length: 40 }, (_, index) => ({
                source_name: `cc_subject_${String(Math.floor(index / 20) + 1).padStart(2, "0")}`,
                fraction_id: `slice_${String((index % 20) + 1).padStart(2, "0")}`,
                data_file: `raw_${String(index + 1).padStart(2, "0")}.raw`,
              })),
              summary: "Two corpus callosum samples with fractionated raw files.",
              sources: [{ label: "PDF", value: "8 samples in two pools", location: "publication" }],
            }),
          },
        }],
      }),
    }));

    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    expect((await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement).value).toBe("Two corpus callosum samples with fractionated raw files.");
    await userEvent.click(screen.getByRole("button", { name: /Accept/i }));

    expect(await screen.findByText(/AI JSON filled into the left-side sample attributes/i)).toBeTruthy();
    expect(screen.getByText(/session storage was not updated/i)).toBeTruthy();
    expect((screen.getByLabelText("Comma-separated sample names") as HTMLInputElement).value).toBe("cc_subject_01, cc_subject_02");
    expect(screen.getByTestId("sample-property-organism")).toBeTruthy();
  });

  it("limits AI sample metadata fields to the selected template stack", async () => {
    window.localStorage.setItem("sdrf-studio-session-state:project-1", JSON.stringify({
      templates: { selectedTemplates: ["ms-proteomics", "human", "clinical-metadata"] },
    }));
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              sample_groups: [],
              summary: "No sample groups generated.",
              sources: [],
            }),
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({});
    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    const aiSummary = await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement;
    expect(aiSummary.value).toBe("No sample groups generated.");

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const userInput = JSON.parse(requestBody.messages[1].content);
    expect(requestBody.messages[0].content).toContain("sdrf-core-mapping-v1");
    expect(userInput.core_mapping_candidate).toBeUndefined();
    expect(userInput.current_sdrf_table_summary).toBeUndefined();
    expect(userInput.evidence_policy.use_existing_sdrf).toBe(false);
    expect(userInput.editor_flow.join(" ")).toContain("left-side sample roster");
    expect(userInput.output_schema.schema_version).toBe("sdrf-core-mapping-v1");
    expect(userInput.output_schema.mapping_rows[0]).toEqual(expect.objectContaining({
      source_name: expect.any(String),
      acquisition_method: expect.any(String),
      label: expect.any(String),
      pool_id: expect.any(String),
      pool_members: expect.any(Array),
      fraction_id: expect.any(String),
      technical_replicate: expect.any(String),
      data_file: expect.any(String),
    }));
    expect(userInput.output_schema.biological_samples[0]).toEqual(expect.objectContaining({
      pool_id: expect.any(String),
    }));
    expect(userInput.output_schema.pooled_sample_rules).toBeUndefined();
    expect(userInput.output_schema.relationship_layers[0]).toEqual(expect.objectContaining({
      field: expect.any(String),
      label: expect.any(String),
      role: expect.any(String),
      reason: expect.any(String),
    }));
    expect(JSON.stringify(userInput.output_schema.relationship_layers)).not.toContain("8 source-level samples");
    expect(JSON.stringify(userInput.output_schema.relationship_layers)).not.toContain("20 fractions");
    expect(userInput.output_schema.coverage_check.missing_raw_files).toEqual(expect.any(Array));
    expect(userInput.output_schema.required_sdrf_columns).toEqual(expect.arrayContaining([
      "source name",
      "assay name",
      "comment[proteomics data acquisition method]",
      "comment[label]",
      "comment[fraction identifier]",
      "comment[technical replicate]",
      "comment[data file]",
    ]));
    expect(userInput.metadata_generation_rules.join(" ")).toContain("Do not put acquisition_method into factor_values");
    expect(userInput.metadata_generation_rules.join(" ")).toContain("Every group must include every required_metadata_fields key");
    expect(userInput.selected_template_metadata_requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ template_id: "human" }),
      expect.objectContaining({ template_id: "clinical-metadata" }),
    ]));
    expect(userInput.required_metadata_fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ requirement: "required" }),
    ]));
    expect(userInput.evidence_optional_metadata_fields).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ requirement: "required" }),
    ]));
    expect(userInput.output_schema.sample_groups[0].metadata.organism).toEqual(expect.objectContaining({
      value: expect.any(String),
      reason: expect.any(String),
      sources: expect.any(Array),
    }));
    expect(userInput.selected_template_ids).toEqual(["ms-proteomics", "human", "clinical-metadata"]);
    expect(userInput.allowed_metadata_fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "bodyMassIndex", sdrf_column: "characteristics[body mass index]" }),
    ]));
    expect(userInput.allowed_metadata_fields).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "diseaseStaging" }),
    ]));
  });

  it("sends structured sample evidence and excludes current SDRF table context from Samples AI", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              schema_version: "sdrf-sample-design-v1",
              grouping_strategy: {
                selected_grouping_fields: ["treatment", "timepoint"],
                candidate_grouping_fields: [{ field: "treatment", values: ["EGF"], reason: "PDF and RAW filenames encode treatment." }],
                rejected_grouping_fields: [{ field: "fraction", reason: "Fractions are technical context." }],
                reason: "Treatment and timepoint explain the biological comparison.",
                sources: [{ label: "PDF", value: "EGF for 5 or 15 min", location: "publication PDF" }],
              },
              sample_groups: [{
                group_name: "EGF 15 min proteome",
                sample_count: 4,
                naming_prefix: "EGF15_PROT",
                metadata: {
                  organism: "Homo sapiens",
                  organismPart: "cell culture",
                  disease: "not available",
                  treatment: "100 ng/ml EGF, 15 min",
                },
                assay_context: {
                  preparation: "Proteome",
                  fractions: ["pH3", "pH4"],
                  raw_file_count: 24,
                },
                warnings: ["Phospho_EGF duration is ambiguous."],
              }],
              summary: "Grouped by AI-selected treatment and timepoint.",
              sources: [{ label: "RAW", value: "EGF15", location: "raw file summary" }],
            }),
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({});
    renderSamplesStep({
      analysis: {
        evidences: [{
          id: "sample-evidence-1",
          source_type: "sample-evidence",
          source_ref: "PXD000612",
          field: "sample evidence bundle",
          value: "raw_files=273",
          confidence: 0.9,
          status: "suggested",
          payload: {
            schema_version: "sample-evidence-v1",
            evidence_policy: { use_existing_sdrf: false },
            raw_file_summary: {
              raw_file_count: 273,
              raw_file_names: ["20120310_EXQ5_KiSh_SA_LabelFree_HeLa_Proteome_EGF15_rep1_pH11.raw"],
              conditions: ["legacy parsed condition"],
              groups_by_condition: [{ condition: "legacy parsed condition", raw_file_count: 1 }],
              semantic_parsing: "disabled",
              interpretation_note: "AI must infer conditions, preparations, replicates, fractions, labels, and acquisition methods from raw_file_names.",
            },
          },
        }],
        questions: [],
        blueprint: { nodes: [], edges: [] },
        summary: {},
      },
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "characteristics[disease]", "factor value[compound]", "factor value[enrichment process]", "comment[fraction identifier]"],
        rows: [
          { "source name": "existing_from_sdrf_1", "characteristics[disease]": "adenocarcinoma", "factor value[compound]": "none", "factor value[enrichment process]": "no enrichment", "comment[fraction identifier]": "1" },
          { "source name": "existing_from_sdrf_2", "characteristics[disease]": "adenocarcinoma", "factor value[compound]": "none", "factor value[enrichment process]": "enrichment of phosphorylated Protein", "comment[fraction identifier]": "2" },
          { "source name": "existing_from_sdrf_3", "characteristics[disease]": "adenocarcinoma", "factor value[compound]": "EGF", "factor value[enrichment process]": "no enrichment", "comment[fraction identifier]": "1" },
          { "source name": "existing_from_sdrf_4", "characteristics[disease]": "adenocarcinoma", "factor value[compound]": "EGF", "factor value[enrichment process]": "enrichment of phosphorylated Protein", "comment[fraction identifier]": "2" },
        ],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    expect(await screen.findByText("Grouping strategy")).toBeTruthy();
    expect(screen.getByText("1 sample group parsed")).toBeTruthy();
    expect(screen.queryByText(/AI draft was expanded to 4 observed group/i)).toBeNull();

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const userInput = JSON.parse(requestBody.messages[1].content);
    expect(requestBody.messages[0].content).toContain("reconstruct the experiment in stages");
    expect(userInput.grouping_policy).toBe("ai_select_experimental_conditions");
    expect(userInput.evidence_policy.use_existing_sdrf).toBe(false);
    expect(userInput.evidence_policy.excluded_sources).toEqual(expect.arrayContaining(["existing SDRF"]));
    expect(userInput.evidence_priority[0]).toBe("publication PDF sample evidence");
    expect(userInput.sample_evidence_bundle).toEqual(expect.objectContaining({
      schema_version: "sample-evidence-v1",
    }));
    expect(userInput.raw_file_evidence).toEqual(expect.objectContaining({ raw_file_count: 273 }));
    expect(userInput.raw_file_evidence.raw_file_names).toEqual([
      "20120310_EXQ5_KiSh_SA_LabelFree_HeLa_Proteome_EGF15_rep1_pH11.raw",
    ]);
    expect(userInput.raw_file_evidence.semantic_parsing).toBe("disabled");
    expect(userInput.raw_file_evidence.conditions).toBeUndefined();
    expect(userInput.raw_file_evidence.groups_by_condition).toBeUndefined();
    expect(userInput.sample_evidence_bundle.raw_file_summary.conditions).toBeUndefined();
    expect(userInput.sample_evidence_bundle.raw_file_summary.groups_by_condition).toBeUndefined();
    expect(userInput.current_sdrf_table_summary).toBeUndefined();
    expect(userInput.core_mapping_candidate).toBeUndefined();
    expect(JSON.stringify(userInput)).not.toContain("existing_from_sdrf_1");
    expect(userInput.metadata_generation_rules.join(" ")).toContain("Do not use existing SDRF files");
  });

  it("has the model read backend PDF page text before generating Samples AI core mapping", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({
      schema_version: "sample-ai-evidence-input-v1",
      evidence_policy: {
        use_existing_sdrf: false,
        excluded_sources: ["existing SDRF", "current SDRF table rows"],
      },
      publication_documents: [{
        source_type: "uploaded publication PDF",
        source_ref: "PXD000547.pdf",
        semantic_processing: "none",
        page_count: 2,
        pages: [
          {
            page: 2,
            text: "We set up two pools for ATL and CC samples from eight subjects. Subjects 1-4 comprised one pool, whereas 5-8 comprised other pools. Table 1 lists sample ID 01, age 41 years, gender F, cause of death cardiopulmonary insufficiency.",
          },
          {
            page: 3,
            text: "Each gel lane containing stained protein bands was sliced equally into 20 sections.",
          },
        ],
      }],
      raw_file_evidence: {
        raw_file_count: 2,
        raw_file_names: [
          "dms_04Jul13_CC_Proteome_Slice01_01.RAW",
          "dms_04Jul13_CC_Proteome_Slice01_02.RAW",
        ],
        semantic_parsing: "disabled",
      },
      project_metadata_evidence: {
        pride_project: { title: "Proteome of the Human Corpus Callosum" },
      },
    });
    vi.spyOn(api, "saveSampleAiPrompt").mockResolvedValue({
      status: "saved",
      filename: "debug.json",
      path: "E:/debug/debug.json",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                sample_facts: [{ value: "eight subjects", page: 2 }],
                individual_sample_facts: [{
                  page: 2,
                  source_name: "subject_01",
                  values: {
                    age: "41Y",
                    sex: "female",
                    disease: "cardiopulmonary insufficiency",
                    pool_id: "pool_1",
                  },
                  quote: "sample ID 01, age 41 years, gender F",
                  meaning: "Table 1 describes one source-level subject.",
                }],
                pool_facts: [{ value: "subjects 1-4 and 5-8 form two pools", page: 2 }],
                fractionation_facts: [{ value: "20 sections", page: 3 }],
                citations: [{ page: 2, quote: "We set up two pools" }],
              }),
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                sample_groups: [{
                  group_name: "Corpus Callosum",
                  sample_count: 8,
                  naming_prefix: "cc",
                  metadata: { organismPart: "corpus callosum" },
                }],
                mapping_rows: [],
                summary: "Eight subjects split into two pools and 20 gel sections.",
                sources: [{ label: "PDF", value: "two pools", location: "page 2" }],
              }),
            },
          }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));

    expect(await screen.findByText("1 sample group parsed")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const pdfRequest = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const pdfUserInput = JSON.parse(pdfRequest.messages[1].content);
    expect(pdfRequest.messages[0].content).toContain("Extract experiment-design facts from publication PDF text");
    expect(pdfRequest.messages[0].content).toContain("individual_sample_facts");
    expect(JSON.stringify(pdfUserInput.publication_documents)).toContain("We set up two pools");
    expect(JSON.stringify(pdfUserInput.publication_documents)).toContain("20 sections");
    expect(pdfUserInput.output_schema.individual_sample_facts[0]).toEqual(expect.objectContaining({
      source_name: expect.any(String),
      values: expect.objectContaining({
        age: expect.any(String),
        sex: expect.any(String),
        disease: expect.any(String),
        pool_id: expect.any(String),
      }),
    }));

    const coreRequest = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    const coreUserInput = JSON.parse(coreRequest.messages[1].content);
    expect(coreRequest.messages[0].content).toContain("Use compact Core Mapping JSON");
    expect(coreRequest.messages[0].content).toContain("individual_sample_facts");
    expect(coreUserInput.output_schema).toBeUndefined();
    expect(coreUserInput.output_contract.required_top_level_keys).toEqual(expect.arrayContaining([
      "sample_groups",
      "mapping_groups",
      "relationship_layers",
    ]));
    expect(coreUserInput.output_contract.biological_sample_fields).toEqual(expect.arrayContaining([
      "source_name",
      "metadata",
      "pool_id",
    ]));
    expect(coreUserInput.evidence_policy.use_existing_sdrf).toBe(false);
    expect(coreUserInput.publication_pdf_fact_extraction.pool_facts[0].value).toContain("two pools");
    expect(coreUserInput.publication_pdf_fact_extraction.individual_sample_facts[0]).toEqual(expect.objectContaining({
      source_name: "subject_01",
    }));
    expect(coreUserInput.publication_documents[0].pages).toBeUndefined();
    expect(coreUserInput.raw_file_evidence.raw_file_names).toEqual([
      "dms_04Jul13_CC_Proteome_Slice01_01.RAW",
      "dms_04Jul13_CC_Proteome_Slice01_02.RAW",
    ]);
    expect(JSON.stringify(coreUserInput)).not.toContain("sdrf.tsv");
  });

  it("uses raw file IDs in compact Samples AI and expands mapping groups locally", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({
      schema_version: "sample-ai-evidence-input-v1",
      evidence_policy: {
        use_existing_sdrf: false,
        excluded_sources: ["existing SDRF", "current SDRF table rows"],
      },
      publication_documents: [{
        source_type: "uploaded publication PDF",
        source_ref: "PXD000396.pdf",
        semantic_processing: "none",
        page_count: 1,
        pages: [{
          page: 1,
          text: "HeLa peptide mixtures were measured with two technical replicate raw files.",
        }],
      }],
      raw_file_evidence: {
        raw_file_count: 2,
        raw_file_names: [
          "120315QEx2_RS1_50nl-min_10ngHeLa_1h_01.raw",
          "120315QEx2_RS1_50nl-min_10ngHeLa_1h_02.raw",
        ],
        semantic_parsing: "disabled",
      },
    });
    vi.spyOn(api, "saveSampleAiPrompt").mockResolvedValue({
      status: "saved",
      filename: "debug.json",
      path: "E:/debug/debug.json",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                sample_facts: [{ value: "HeLa peptide mixtures", page: 1 }],
                citations: [{ page: 1, quote: "HeLa peptide mixtures" }],
              }),
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                sample_groups: [{
                  group_name: "HeLa 10 ng",
                  sample_count: 1,
                  naming_prefix: "hela_10ng",
                  metadata: { cellLine: "HeLa" },
                  factor_values: [],
                }],
                mapping_groups: [{
                  raw_file_ids: ["RF001", "RF002"],
                  source_name: "hela_10ng_01",
                  sample_group: "HeLa 10 ng",
                  biological_replicate: "1",
                  label: "label free sample",
                  fraction_id: "not available",
                  acquisition_method: "LC-MS/MS",
                  technical_replicate: "not available",
                  assay_name: "hela_10ng_assay",
                  warnings: ["Technical replicate was not assigned by the model."],
                }],
                coverage_check: { warnings: [] },
                summary: "HeLa files mapped by raw file IDs.",
                sources: [{ label: "PDF", value: "HeLa peptide mixtures", location: "page 1" }],
              }),
            },
          }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    expect((await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement).value).toBe("HeLa files mapped by raw file IDs.");

    const coreRequest = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    const coreUserInput = JSON.parse(coreRequest.messages[1].content);
    expect(coreUserInput.raw_file_evidence.raw_file_catalog).toEqual([
      { id: "RF001", name: "120315QEx2_RS1_50nl-min_10ngHeLa_1h_01.raw" },
      { id: "RF002", name: "120315QEx2_RS1_50nl-min_10ngHeLa_1h_02.raw" },
    ]);
    expect(coreUserInput.output_contract.required_top_level_keys).toEqual(expect.arrayContaining(["mapping_groups"]));
    expect(coreUserInput.output_contract.mapping_group_fields).toEqual(expect.arrayContaining(["raw_file_ids"]));

    const session = JSON.parse(window.localStorage.getItem("sdrf-studio-session-state:project-1") ?? "{}");
    expect(session.samples.aiDraft.mapping_rows).toEqual([
      expect.objectContaining({
        data_file: "120315QEx2_RS1_50nl-min_10ngHeLa_1h_01.raw",
        source_name: "hela_10ng_01",
        sample_group: "HeLa 10 ng",
        assay_name: "hela_10ng_assay",
      }),
      expect.objectContaining({
        data_file: "120315QEx2_RS1_50nl-min_10ngHeLa_1h_02.raw",
        source_name: "hela_10ng_01",
        sample_group: "HeLa 10 ng",
        assay_name: "hela_10ng_assay",
      }),
    ]);
  });

  it("warns when compact Samples AI raw file IDs are missing, duplicate, or unknown", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.spyOn(api, "buildSampleDesignAiInput").mockResolvedValue({
      publication_documents: [{
        source_type: "uploaded publication PDF",
        source_ref: "paper.pdf",
        semantic_processing: "none",
        pages: [{ page: 1, text: "Three raw files were acquired." }],
      }],
      raw_file_evidence: {
        raw_file_count: 3,
        raw_file_names: ["file_a.raw", "file_b.raw", "file_c.raw"],
      },
    });
    vi.spyOn(api, "saveSampleAiPrompt").mockResolvedValue({
      status: "saved",
      filename: "debug.json",
      path: "E:/debug/debug.json",
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ sample_facts: [{ value: "three raw files" }] }) } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                sample_groups: [{
                  group_name: "HeLa",
                  sample_count: 1,
                  naming_prefix: "hela",
                  metadata: { cellLine: "HeLa" },
                }],
                mapping_groups: [{
                  raw_file_ids: ["RF001", "RF001", "RF999"],
                  source_name: "hela_01",
                  sample_group: "HeLa",
                  assay_name: "hela_assay",
                }],
                summary: "Coverage warning test.",
                sources: [],
              }),
            },
          }],
        }),
      }));
    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    expect((await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement).value).toBe("Coverage warning test.");

    const session = JSON.parse(window.localStorage.getItem("sdrf-studio-session-state:project-1") ?? "{}");
    expect(session.samples.aiDraft.mapping_rows).toHaveLength(1);
    expect(session.samples.aiDraft.mapping_rows[0].data_file).toBe("file_a.raw");
    expect(session.samples.aiDraft.coverage_check.warnings).toEqual(expect.arrayContaining([
      "AI mapping_groups referenced unknown raw file ID(s): RF999.",
      "AI mapping_groups referenced duplicate raw file ID(s): RF001.",
      "AI mapping_groups did not cover raw file ID(s): RF002, RF003.",
    ]));
  });

  it("uses the same assistant layout structure as Templates for AI sample drafts", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              sample_groups: [{
                group_name: "Control",
                sample_count: 2,
                naming_prefix: "CTRL",
                metadata: {
                  organism: "Homo sapiens",
                  organismPart: "plasma",
                },
              }],
              summary: "Control plasma samples detected.",
              sources: [{ label: "Organism", value: "Homo sapiens", location: "Import > PRIDE metadata" }],
            }),
          },
        }],
      }),
    }));
    renderSamplesStep();

    await userEvent.click(screen.getByRole("button", { name: /Run AI/i }));
    const aiSummary = await screen.findByLabelText("AI sample JSON summary") as HTMLTextAreaElement;
    expect(aiSummary.value).toBe("Control plasma samples detected.");

    const assistant = screen.getByText("Sample recommendation").closest(".assistant-recommendation");
    expect(assistant).toBeTruthy();
    expect(assistant?.className).toBe("assistant-recommendation");
    expect(within(assistant as HTMLElement).getByText("Why this design").closest(".assistant-decision-section")).toBeTruthy();
    expect(within(assistant as HTMLElement).getByText("Import evidence").closest(".assistant-source-group")).toBeTruthy();
  });
});

describe("Workflow assistant shell", () => {
  afterEach(() => cleanup());
  afterEach(() => {
    window.localStorage.removeItem("sdrf-studio-ai-config");
    window.localStorage.removeItem("sdrf-studio-session-state:project-1");
    window.localStorage.removeItem("sdrf-studio-project-id");
    window.localStorage.removeItem("sdrf-studio-step");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renames step 2 to Templates", () => {
    expect(steps[1].label).toBe("Templates");
  });

  it("places Files after Blueprint and removes Assays and Ontology from the main workflow", () => {
    expect(steps.map((step) => step.key)).toEqual([
      "import",
      "ai-analysis",
      "samples",
      "blueprint",
      "files",
      "ai-review",
      "validation",
      "export",
    ]);
  });

  it("uses Ai Assistant as the reusable right rail name", () => {
    render(<AssistantPanel />);

    expect(screen.getByText("Ai Assistant")).toBeTruthy();
    expect(screen.queryByText("AI Mapping Assistant")).toBeNull();
  });

  it("uses the Samples assistant layout for Blueprint AI", async () => {
    vi.stubGlobal("ResizeObserver", class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    renderAppAtStep("blueprint", {
      analysis: {
        evidences: [],
        questions: [],
        blueprint: {
          nodes: [{ id: "node-1", layer: "sample", label: "sample_01", status: "suggested", confidence: 0.8, payload: {} }],
          edges: [],
        },
        summary: {},
      },
    });

    const heading = await screen.findByText("Blueprint builder");
    const page = heading.closest(".content-grid");
    expect(page?.classList.contains("templates-content-grid")).toBe(true);
    expect(page?.classList.contains("samples-content-grid")).toBe(true);
    const rail = page?.querySelector(".right-rail");
    expect(rail?.classList.contains("template-assistant-rail")).toBe(true);
    expect(rail?.querySelector(".template-assistant-panel")).toBeTruthy();
    expect(rail?.querySelector(".assistant-recommendation")).toBeTruthy();
    expect(within(rail as HTMLElement).getByRole("button", { name: /Add AI draft/i })).toBeTruthy();
  });

  it("uses the Samples assistant layout for Files AI", async () => {
    renderAppAtStep("files", {
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "comment[data file]"],
        rows: [{ "source name": "sample_01", "comment[data file]": "sample_01.raw" }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    const heading = await screen.findByRole("heading", { name: "Technical Configuration" });
    const page = heading.closest(".content-grid");
    expect(page?.classList.contains("templates-content-grid")).toBe(true);
    expect(page?.classList.contains("samples-content-grid")).toBe(true);
    const rail = page?.querySelector(".right-rail");
    expect(rail?.classList.contains("template-assistant-rail")).toBe(true);
    expect(rail?.querySelector(".template-assistant-panel")).toBeTruthy();
    expect(rail?.querySelector(".assistant-recommendation")).toBeTruthy();
    expect(within(rail as HTMLElement).getByRole("button", { name: "Run AI" })).toBeTruthy();
  });
});

describe("FilesStep technical configuration", () => {
  afterEach(() => cleanup());
  afterEach(() => {
    window.localStorage.removeItem("sdrf-studio-ai-config");
    window.localStorage.removeItem("sdrf-studio-files-ai-draft:project-1");
    window.localStorage.removeItem("sdrf-studio-session-state:project-1");
    window.localStorage.removeItem("sdrf-studio-project-id");
    window.localStorage.removeItem("sdrf-studio-step");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts file mapping from generated inputs instead of imported SDRF table rows", async () => {
    renderAppAtStep("files", {
      files: [{
        id: "file-1",
        project_id: "project-1",
        filename: "generated.raw",
        content_type: "application/octet-stream",
        file_type: "raw",
        sha256: "abc",
        size_bytes: 123,
        parse_status: "stored",
        parsed_payload: {},
        created_at: "2026-06-17T00:00:00Z",
      }],
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "assay name", "comment[label]", "comment[data file]"],
        rows: [{
          "source name": "imported_sdrf_sample",
          "assay name": "imported_run",
          "comment[label]": "imported label",
          "comment[data file]": "imported.raw",
        }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    expect(await screen.findByRole("heading", { name: "Technical Configuration" })).toBeTruthy();
    expect(await screen.findByDisplayValue("generated.raw")).toBeTruthy();
    expect(screen.queryByDisplayValue("imported_sdrf_sample")).toBeNull();
    expect(screen.queryByDisplayValue("imported_run")).toBeNull();
    expect(screen.queryByDisplayValue("imported.raw")).toBeNull();
  });

  it("saves MS-proteomics technical fields into the SDRF table", async () => {
    const putSdrfTable = vi.spyOn(api, "putSdrfTable").mockImplementation(async (_projectId, table) => table);
    renderAppAtStep("files", {
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "characteristics[organism]", "comment[data file]"],
        rows: [{
          "source name": "sample_01",
          "characteristics[organism]": "Homo sapiens",
          "comment[data file]": "sample_01.raw",
        }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    expect(await screen.findByRole("heading", { name: "Technical Configuration" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /TMT 10-plex/i }));
    await userEvent.click(screen.getByRole("button", { name: "Fractionated" }));
    await userEvent.clear(screen.getByLabelText("Fraction IDs"));
    await userEvent.type(screen.getByLabelText("Fraction IDs"), "F1, F2");
    await userEvent.clear(screen.getByLabelText("Instrument"));
    await userEvent.type(screen.getByLabelText("Instrument"), "Orbitrap Fusion Lumos");
    await userEvent.clear(screen.getByLabelText("Acquisition method"));
    await userEvent.type(screen.getByLabelText("Acquisition method"), "DDA");
    await userEvent.click(screen.getByRole("button", { name: "Save technical configuration" }));

    await waitFor(() => expect(putSdrfTable).toHaveBeenCalled());
    const savedTable = putSdrfTable.mock.calls[0][1] as SdrfTable;
    expect(savedTable.headers).toEqual(expect.arrayContaining([
      "assay name",
      "technology type",
      "comment[proteomics data acquisition method]",
      "comment[label]",
      "comment[instrument]",
      "comment[cleavage agent details]",
      "comment[fraction identifier]",
      "comment[technical replicate]",
      "comment[data file]",
    ]));
    expect(savedTable.rows[0]).toMatchObject({
      "source name": "sample_01",
      "assay name": "assay_01",
      "technology type": "mass spectrometry",
      "comment[proteomics data acquisition method]": "DDA",
      "comment[label]": "TMT126",
      "comment[instrument]": "Orbitrap Fusion Lumos",
      "comment[cleavage agent details]": "Trypsin",
      "comment[fraction identifier]": "F1",
      "comment[technical replicate]": "1",
      "comment[data file]": "sample_01.raw",
    });
  });

  it("saves selected post-translational modifications into the SDRF table", async () => {
    const putSdrfTable = vi.spyOn(api, "putSdrfTable").mockImplementation(async (_projectId, table) => table);
    renderAppAtStep("files", {
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "comment[data file]"],
        rows: [{ "source name": "sample_01", "comment[data file]": "sample_01.raw" }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    expect(await screen.findByRole("heading", { name: "Technical Configuration" })).toBeTruthy();
    expect(screen.getByText("Post-Translational Modifications")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Oxidation (M)" }));
    await userEvent.click(screen.getByRole("button", { name: "Save technical configuration" }));

    await waitFor(() => expect(putSdrfTable).toHaveBeenCalled());
    const savedTable = putSdrfTable.mock.calls[0][1] as SdrfTable;
    expect(savedTable.headers).toContain("comment[modification parameters]");
    expect(savedTable.rows[0]["comment[modification parameters]"]).toBe("Carbamidomethyl (C); Oxidation (M)");
  });

  it("fills data-file technical attributes from the Files AI assistant", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    const savePrompt = vi.spyOn(api, "saveSampleAiPrompt").mockResolvedValue({
      status: "saved",
      filename: "files-ai.json",
      path: "storage/project-1/debug/sample-ai-prompts/files-ai.json",
    });
    const putSdrfTable = vi.spyOn(api, "putSdrfTable").mockImplementation(async (_projectId, table) => table);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "AI inferred TMT file attributes.",
              label_type: "TMT 10-plex",
              labels: ["TMT126", "TMT127N"],
              fraction_ids: ["F1"],
              acquisition_method: "DIA",
              instrument: "Orbitrap Exploris 480",
              cleavage_agent: "Lys-C",
              file_mappings: [{
                source_name: "sample_01",
                assay_name: "ai_assay_01",
                label: "TMT126",
                fraction_id: "F1",
                technical_replicate: "2",
                data_file: "sample_01.raw",
              }],
              warnings: ["Review channel assignment."],
            }),
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAppAtStep("files", {
      files: [{
        id: "file-1",
        project_id: "project-1",
        filename: "sample_01.raw",
        content_type: "application/octet-stream",
        file_type: "raw",
        sha256: "abc",
        size_bytes: 123,
        parse_status: "stored",
        parsed_payload: {},
        created_at: "2026-06-17T00:00:00Z",
      }],
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "characteristics[organism]", "comment[data file]"],
        rows: [{
          "source name": "sample_01",
          "characteristics[organism]": "Homo sapiens",
          "comment[data file]": "sample_01.raw",
        }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Run AI" }));

    expect(screen.getByText("AI inferred TMT file attributes.")).toBeTruthy();
    expect(screen.getByText("Review channel assignment.")).toBeTruthy();
    expect(screen.queryByDisplayValue("Orbitrap Exploris 480")).toBeNull();
    expect(screen.getByDisplayValue("not available")).toBeTruthy();
    expect(screen.getByDisplayValue("DDA")).toBeTruthy();
    expect(screen.getByDisplayValue("Trypsin")).toBeTruthy();
    expect(screen.getByDisplayValue("assay_01")).toBeTruthy();
    expect(screen.getByDisplayValue("label free sample")).toBeTruthy();
    expect(savePrompt).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(savePrompt.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);

    const savedPayload = savePrompt.mock.calls[0][1] as { messages: Array<{ content: string }> };
    const filesAiInput = JSON.parse(savedPayload.messages[1].content);
    expect(filesAiInput.uploaded_files[0].filename).toBe("sample_01.raw");
    expect(filesAiInput.current_sdrf_table.headers).toEqual([]);
    expect(filesAiInput.current_file_mappings[0].dataFile).toBe("sample_01.raw");
    expect(filesAiInput.current_technical_state.instrument).toBe("not available");
    expect(JSON.stringify(savedPayload)).not.toContain("test-key");

    await userEvent.click(screen.getByRole("button", { name: "Apply AI draft" }));
    expect(await screen.findByDisplayValue("Orbitrap Exploris 480")).toBeTruthy();
    expect(screen.getByDisplayValue("DIA")).toBeTruthy();
    expect(screen.getByDisplayValue("Lys-C")).toBeTruthy();
    expect(screen.getByDisplayValue("ai_assay_01")).toBeTruthy();
    expect(screen.getByDisplayValue("TMT126")).toBeTruthy();
    expect(screen.getAllByDisplayValue("F1").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("2")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Save technical configuration" }));
    await waitFor(() => expect(putSdrfTable).toHaveBeenCalled());
    const savedTable = putSdrfTable.mock.calls[0][1] as SdrfTable;
    expect(savedTable.rows[0]).toMatchObject({
      "source name": "sample_01",
      "assay name": "ai_assay_01",
      "technology type": "mass spectrometry",
      "comment[proteomics data acquisition method]": "DIA",
      "comment[label]": "TMT126",
      "comment[instrument]": "Orbitrap Exploris 480",
      "comment[cleavage agent details]": "Lys-C",
      "comment[fraction identifier]": "F1",
      "comment[technical replicate]": "2",
      "comment[data file]": "sample_01.raw",
    });
  });

  it("includes PRIDE project evidence in the Files AI prompt when no SDRF rows or uploads are available", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      model: "test-model",
    }));
    const savePrompt = vi.spyOn(api, "saveSampleAiPrompt").mockResolvedValue({
      status: "saved",
      filename: "files-ai.json",
      path: "storage/project-1/debug/sample-ai-prompts/files-ai.json",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "AI used project metadata.",
              acquisition_method: "DDA",
              instrument: "LTQ Orbitrap Velos",
              cleavage_agent: "Trypsin",
              file_mappings: [],
              warnings: [],
            }),
          },
        }],
      }),
    }));

    renderAppAtStep("files", {
      analysis: {
        evidences: [{
          id: "evidence-project",
          source_type: "pride",
          source_ref: "PXD000070",
          field: "project metadata",
          value: "Plasmodium falciparum schizont phosphoproteome",
          confidence: 0.95,
          status: "accepted",
          payload: {
            project: {
              accession: "PXD000070",
              title: "Plasmodium falciparum schizont phosphoproteome",
              description: "Phosphopeptides were analysed using ETD and CID. All searches used Mascot with trypsin and variable Oxidation (M), Deamidated (NQ), Carbamidomethyl (C), and Phospho ST.",
              instruments: ["LTQ Orbitrap Velos"],
              modifications: "monohydroxylated residue phosphorylated residue acetylated residue iodoacetamide derivatized residue deamidated residue",
            },
          },
        }],
        questions: [],
        blueprint: { nodes: [], edges: [] },
        summary: {},
      },
      files: [],
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name"],
        rows: [],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Run AI" }));

    await waitFor(() => expect(savePrompt).toHaveBeenCalled());
    const savedPayload = savePrompt.mock.calls[0][1] as { messages: Array<{ content: string }> };
    const filesAiInput = JSON.parse(savedPayload.messages[1].content);
    const projectEvidence = JSON.stringify(filesAiInput.project_evidence ?? "");
    expect(projectEvidence).toContain("LTQ Orbitrap Velos");
    expect(projectEvidence).toContain("Phosphopeptides were analysed using ETD and CID");
    expect(projectEvidence).toContain("monohydroxylated residue");
  });

  it("keeps Files AI draft available after navigating away until the user applies it", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.spyOn(api, "saveSampleAiPrompt").mockResolvedValue({
      status: "saved",
      filename: "files-ai.json",
      path: "storage/project-1/debug/sample-ai-prompts/files-ai.json",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "Persistent file draft.",
              label_type: "Label-free (LFQ)",
              labels: ["label free sample"],
              fraction_ids: ["1"],
              acquisition_method: "DIA",
              instrument: "Orbitrap Exploris 480",
              cleavage_agent: "Trypsin",
              file_mappings: [{
                source_name: "sample_01",
                assay_name: "ai_assay_01",
                label: "label free sample",
                fraction_id: "1",
                technical_replicate: "1",
                data_file: "sample_01.raw",
              }],
              warnings: [],
            }),
          },
        }],
      }),
    }));

    renderAppAtStep("files", {
      files: [{
        id: "file-1",
        project_id: "project-1",
        filename: "sample_01.raw",
        content_type: "application/octet-stream",
        file_type: "raw",
        sha256: "abc",
        size_bytes: 123,
        parse_status: "stored",
        parsed_payload: {},
        created_at: "2026-06-17T00:00:00Z",
      }],
    });

    await userEvent.click(await screen.findByRole("button", { name: "Run AI" }));
    expect(await screen.findByText("Persistent file draft.")).toBeTruthy();
    expect(screen.queryByDisplayValue("Orbitrap Exploris 480")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Samples" }));
    expect(await screen.findByRole("heading", { name: "Samples & Characteristics" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Files" }));

    expect(await screen.findByText("Persistent file draft.")).toBeTruthy();
    expect(screen.queryByDisplayValue("Orbitrap Exploris 480")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Apply AI draft" }));
    expect(await screen.findByDisplayValue("Orbitrap Exploris 480")).toBeTruthy();
  });

  it("shows the Samples-style pending animation and layout while Files AI is running", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    vi.spyOn(api, "saveSampleAiPrompt").mockResolvedValue({
      status: "saved",
      filename: "files-ai.json",
      path: "storage/project-1/debug/sample-ai-prompts/files-ai.json",
    });
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    renderAppAtStep("files", {
      files: [{
        id: "file-1",
        project_id: "project-1",
        filename: "sample_01.raw",
        content_type: "application/octet-stream",
        file_type: "raw",
        sha256: "abc",
        size_bytes: 123,
        parse_status: "stored",
        parsed_payload: {},
        created_at: "2026-06-17T00:00:00Z",
      }],
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "comment[data file]"],
        rows: [{ "source name": "sample_01", "comment[data file]": "sample_01.raw" }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    const assistantHeading = await screen.findByText("Data file attributes");
    const rail = assistantHeading.closest(".right-rail") as HTMLElement;
    await userEvent.click(within(rail).getByRole("button", { name: "Run AI" }));

    expect(await within(rail).findByText("AI is reading import context")).toBeTruthy();
    const loadingCard = within(rail).getByText("AI is reading import context").closest(".assistant-loading-card");
    expect(loadingCard).toBeTruthy();
    expect(loadingCard?.querySelector(".assistant-spinner")).toBeTruthy();
    expect(within(rail).getByText("Analyzing")).toBeTruthy();
    expect(rail.querySelector(".assistant-compact-meta")).toBeTruthy();
    expect(rail.querySelector(".recommendation-stack")).toBeTruthy();
    expect(within(rail).getByText("Recommended mappings")).toBeTruthy();
    expect(within(rail).getByText("Generating file attribute JSON...")).toBeTruthy();
    expect((within(rail).getByRole("button", { name: "Running" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AiReviewStep", () => {
  afterEach(() => cleanup());
  afterEach(() => {
    window.localStorage.removeItem("sdrf-studio-ai-config");
    window.localStorage.removeItem("sdrf-studio-session-state:project-1");
    window.localStorage.removeItem("sdrf-studio-project-id");
    window.localStorage.removeItem("sdrf-studio-step");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a summarized SDRF completeness review to AI after saving the prompt", async () => {
    window.localStorage.setItem("sdrf-studio-ai-config", JSON.stringify({
      baseUrl: "https://example.test/chat",
      apiKey: "test-key",
      model: "test-model",
    }));
    const savePrompt = vi.spyOn(api, "saveSampleAiPrompt").mockResolvedValue({
      status: "saved",
      filename: "ai-review.json",
      path: "storage/project-1/debug/sample-ai-prompts/ai-review.json",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "The SDRF is almost complete.",
              recommendations: [{ title: "Add instrument", detail: "Fill comment[instrument] before validation." }],
              warnings: ["comment[instrument] is missing."],
            }),
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAppAtStep("ai-review", {
      files: [{
        id: "file-1",
        project_id: "project-1",
        filename: "sample_01.raw",
        content_type: "application/octet-stream",
        file_type: "raw",
        sha256: "abc",
        size_bytes: 123,
        parse_status: "stored",
        parsed_payload: {},
        created_at: "2026-06-17T00:00:00Z",
      }],
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "assay name", "comment[data file]"],
        rows: [{ "source name": "sample_01", "assay name": "assay_01", "comment[data file]": "sample_01.raw" }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
      analysis: {
        evidences: [{
          id: "evidence-1",
          source_type: "PRIDE",
          source_ref: "PXD000001",
          field: "organism",
          value: "Homo sapiens",
          confidence: 0.95,
          payload: {},
          status: "accepted",
        }],
        questions: [],
        blueprint: { nodes: [], edges: [] },
        summary: {},
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "Ask AI for SDRF review" }));
    expect(await screen.findByText("The SDRF is almost complete.")).toBeTruthy();
    expect(screen.getByText("Add instrument")).toBeTruthy();

    expect(savePrompt).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(savePrompt.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    const savedPayload = savePrompt.mock.calls[0][1] as { messages: Array<{ content: string }> };
    const reviewInput = JSON.parse(savedPayload.messages[1].content);
    expect(reviewInput.current_sdrf_table.headers).toContain("comment[data file]");
    expect(reviewInput.missing_required_fields).toContain("comment[instrument]");
    expect(reviewInput.uploaded_files[0].filename).toBe("sample_01.raw");
    expect(JSON.stringify(savedPayload)).not.toContain("test-key");
  });

  it("renders a review dashboard summary from the current SDRF table", async () => {
    renderAppAtStep("ai-review", {
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: [
          "source name",
          "characteristics[organism]",
          "characteristics[disease]",
          "characteristics[organism part]",
          "characteristics[biological replicate]",
          "comment[label]",
          "comment[fraction identifier]",
          "comment[technical replicate]",
          "comment[instrument]",
          "comment[cleavage agent details]",
          "comment[data file]",
        ],
        rows: [{
          "source name": "sample_1",
          "characteristics[organism]": "Homo sapiens",
          "characteristics[disease]": "normal",
          "characteristics[organism part]": "liver",
          "characteristics[biological replicate]": "1",
          "comment[label]": "label free sample",
          "comment[fraction identifier]": "1",
          "comment[technical replicate]": "1",
          "comment[instrument]": "Q Exactive",
          "comment[cleavage agent details]": "Trypsin",
          "comment[data file]": "sample_1.raw",
        }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    expect(await screen.findByText("Review Your SDRF")).toBeTruthy();
    expect(screen.getByText("Preview the generated SDRF table before creating it.")).toBeTruthy();
    expect(await screen.findByText("Human Samples")).toBeTruthy();
    expect(screen.getByText("Configuration Summary")).toBeTruthy();
    expect(screen.getAllByText("Homo sapiens").length).toBeGreaterThan(0);
    expect(screen.getAllByText("normal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("liver").length).toBeGreaterThan(0);
    expect(screen.getByText("Label-free (LFQ)")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getAllByText("Q Exactive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Trypsin").length).toBeGreaterThan(0);
    expect(screen.getByText("Table Preview")).toBeTruthy();
    expect(screen.getByText("sample_1.raw")).toBeTruthy();
  });

  it("recognizes populated SDRF fields when cached table headers use legacy casing", async () => {
    renderAppAtStep("ai-review", {
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: [
          "Source Name",
          "Characteristics[organism]",
          "characteristics[organism part]",
          "characteristics[disease]",
          "characteristics[biological replicate]",
          "assay name",
          "technology type",
          "comment[proteomics data acquisition method]",
          "comment[label]",
          "comment[instrument]",
          "comment[cleavage agent details]",
          "comment[fraction identifier]",
          "comment[technical replicate]",
          "comment[data file]",
          "factor value[disease]",
        ],
        rows: [{
          "Source Name": "PXD000547-Sample 1",
          "Characteristics[organism]": "Homo sapiens",
          "characteristics[organism part]": "corpus callosum",
          "characteristics[disease]": "cardiopulmonary insufficiency",
          "characteristics[biological replicate]": "1",
          "assay name": "run 1",
          "technology type": "proteomic profiling by mass spectrometry",
          "comment[proteomics data acquisition method]": "DDA",
          "comment[label]": "label free sample",
          "comment[instrument]": "LTQ Orbitrap XL",
          "comment[cleavage agent details]": "Trypsin",
          "comment[fraction identifier]": "1",
          "comment[technical replicate]": "1",
          "comment[data file]": "sample_1.raw",
          "factor value[disease]": "cardiopulmonary insufficiency",
        }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    expect(await screen.findByText("Human Samples")).toBeTruthy();
    expect(screen.getByText("No required MS-proteomics fields are missing from populated rows.")).toBeTruthy();
    expect(screen.getByText("PXD000547-Sample 1")).toBeTruthy();
    expect(screen.getAllByText("Homo sapiens").length).toBeGreaterThan(0);
  });
});

describe("Validation and Export final pages", () => {
  afterEach(() => cleanup());
  afterEach(() => {
    window.localStorage.removeItem("sdrf-studio-ai-config");
    window.localStorage.removeItem("sdrf-studio-session-state:project-1");
    window.localStorage.removeItem("sdrf-studio-project-id");
    window.localStorage.removeItem("sdrf-studio-step");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runs SDRF Pipeline Validation and shows the validator returned by the backend", async () => {
    vi.spyOn(api, "validate").mockResolvedValue({
      id: "validation-1",
      status: "passed",
      issues: [],
      summary: { errors: 0, warnings: 0, infos: 0, validator: "sdrf-pipelines" },
    });
    renderAppAtStep("validation", {
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "assay name", "comment[data file]"],
        rows: [{ "source name": "sample_1", "assay name": "assay_1", "comment[data file]": "sample_1.raw" }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    expect(await screen.findByText("SDRF Pipeline Validation")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Validate SDRF" }));
    expect(await screen.findByText("sdrf-pipelines")).toBeTruthy();
    expect(screen.getByText("No validation issues reported yet.")).toBeTruthy();
  });

  it("shows the complete SDRF table on Export and still generates export records", async () => {
    const exportProject = vi.spyOn(api, "exportProject").mockResolvedValue([{
      id: "export-1",
      export_type: "sdrf-tsv",
      path: "storage/project-1/exports/test.sdrf.tsv",
      payload: { download: "/api/exports/project-1/test.sdrf.tsv" },
    }]);
    renderAppAtStep("export", {
      table: {
        id: "table-1",
        project_id: "project-1",
        headers: ["source name", "characteristics[organism]", "comment[data file]"],
        rows: [{ "source name": "sample_1", "characteristics[organism]": "Homo sapiens", "comment[data file]": "sample_1.raw" }],
        column_metadata: {},
        dirty: false,
        validation_state: {},
      },
    });

    expect(await screen.findByText("Complete SDRF Table")).toBeTruthy();
    expect(await screen.findByText("sample_1")).toBeTruthy();
    expect(screen.getByText("Homo sapiens")).toBeTruthy();
    expect(screen.getByText("sample_1.raw")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Generate exports/i }));
    await waitFor(() => expect(exportProject).toHaveBeenCalledWith("project-1"));
    expect(await screen.findByText("sdrf-tsv")).toBeTruthy();
  });
});
