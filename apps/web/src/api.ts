import type { Analysis, Blueprint, ExportRecord, Project, SdrfTable, UploadedFile, ValidationResult } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

type RequestOptions = RequestInit & { timeoutMs?: number; timeoutMessage?: string };

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const controller = init?.timeoutMs ? new AbortController() : undefined;
  const timeoutMessage = init?.timeoutMessage;
  const timeout = init?.timeoutMs && controller
    ? window.setTimeout(() => controller.abort(), init.timeoutMs)
    : undefined;
  try {
    const { timeoutMs: _timeoutMs, timeoutMessage: _timeoutMessage, signal, ...requestInit } = init ?? {};
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: requestInit.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      ...requestInit,
      signal: controller?.signal ?? signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(timeoutMessage ?? "Request timed out. Please retry.");
    }
    throw error;
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
}

export const api = {
  baseUrl: API_BASE_URL,
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (name = "New SDRF Project") => request<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name }) }),
  deleteProject: (projectId: string) => request<{ status: string }>(`/api/projects/${projectId}`, { method: "DELETE" }),
  saveSampleAiPrompt: (projectId: string, payload: Record<string, unknown>) =>
    request<{ status: string; filename: string; path: string }>(`/api/projects/${projectId}/debug/sample-ai-prompts`, { method: "POST", body: JSON.stringify(payload) }),
  chatCompletion: (payload: Record<string, unknown>, options?: { timeoutMs?: number; timeoutMessage?: string }) =>
    request<Record<string, unknown>>("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: options?.timeoutMs,
      timeoutMessage: options?.timeoutMessage,
    }),
  buildSampleDesignAiInput: (projectId: string) =>
    request<Record<string, unknown>>(`/api/projects/${projectId}/ai/sample-design-input`, { method: "POST" }),
  importPride: (projectId: string, accession: string) =>
    request<Record<string, unknown>>(`/api/projects/${projectId}/imports/pride`, {
      method: "POST",
      body: JSON.stringify({ accession }),
      timeoutMs: 90000,
      timeoutMessage: "PRIDE import timed out. Please retry, or continue by uploading local metadata/design files.",
    }),
  uploadFile: async (projectId: string, file: File, fileType?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (fileType) form.append("file_type", fileType);
    return request<UploadedFile>(`/api/projects/${projectId}/files`, { method: "POST", body: form });
  },
  listFiles: (projectId: string) => request<UploadedFile[]>(`/api/projects/${projectId}/files`),
  deleteFile: (projectId: string, fileId: string) => request<{ status: string }>(`/api/projects/${projectId}/files/${fileId}`, { method: "DELETE" }),
  runAnalysis: (projectId: string) => request<Analysis>(`/api/projects/${projectId}/analysis/run`, { method: "POST" }),
  getAnalysis: (projectId: string) => request<Analysis>(`/api/projects/${projectId}/analysis`),
  getBlueprint: (projectId: string) => request<Blueprint>(`/api/projects/${projectId}/blueprint`),
  putBlueprint: (projectId: string, blueprint: Blueprint) =>
    request<Blueprint>(`/api/projects/${projectId}/blueprint`, { method: "PUT", body: JSON.stringify(blueprint) }),
  getSdrfTable: (projectId: string) => request<SdrfTable>(`/api/projects/${projectId}/sdrf/table`),
  putSdrfTable: (projectId: string, table: SdrfTable) =>
    request<SdrfTable>(`/api/projects/${projectId}/sdrf/table`, { method: "PUT", body: JSON.stringify(table) }),
  validate: (projectId: string) => request<ValidationResult>(`/api/projects/${projectId}/validate`, { method: "POST" }),
  exportProject: (projectId: string) => request<ExportRecord[]>(`/api/projects/${projectId}/export`, { method: "POST" }),
};
