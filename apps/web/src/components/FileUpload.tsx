import { Upload } from "lucide-react";
import { api } from "../api";

export function FileUpload({ projectId, onUploaded }: { projectId: string; onUploaded: () => void }) {
  return (
    <label className="drop-zone">
      <Upload size={36} />
      <span>Drag & drop or choose files</span>
      <small>Supports CSV, TSV, XLSX, PDF and supplementary metadata</small>
      <input
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.xlx,.pdf"
        multiple
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          for (const file of files) {
            await api.uploadFile(projectId, file);
          }
          event.currentTarget.value = "";
          onUploaded();
        }}
      />
    </label>
  );
}
