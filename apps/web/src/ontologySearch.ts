export interface OntologyLookupTerm {
  id: string;
  label: string;
  iri: string;
  ontologyPrefix: string;
  description?: string;
  synonyms?: string[];
  isExactMatch?: boolean;
}

export interface OntologySearchParams {
  query: string;
  ontology?: string[];
  exact?: boolean;
  rows?: number;
  type?: "class" | "property" | "individual";
}

export interface OntologySearchResponse {
  suggestions: OntologyLookupTerm[];
  totalCount: number;
  hasMore: boolean;
  query: string;
  ontologies: string[];
}

export interface OntologySearchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface OntologyFieldDescriptor {
  key?: string;
  column?: string;
  label?: string;
  ontologies?: readonly string[];
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

const OLS_BASE_URL = "https://www.ebi.ac.uk/ols4/api";
const DEFAULT_ROWS = 10;
const DEFAULT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 1000;

const ontologySearchCache = new Map<string, CacheEntry<OntologyLookupTerm[]>>();

const SAMPLE_FIELD_ONTOLOGIES: Record<string, string[]> = {
  organism: ["ncbitaxon"],
  "host organism": ["ncbitaxon"],
  disease: ["efo", "mondo", "doid"],
  "host disease status": ["mondo", "doid"],
  "pre-existing condition": ["mondo", "efo", "doid"],
  "gastrointestinal tract disorder": ["mondo", "doid"],
  "liver disorder": ["mondo", "doid"],
  celltype: ["cl", "bto"],
  "cell type": ["cl", "bto"],
  cellline: ["clo", "efo", "bto"],
  "cell line": ["clo", "efo", "bto"],
  tissue: ["uberon", "bto"],
  "organism part": ["uberon", "bto"],
  organismpart: ["uberon", "bto"],
  "host body site": ["uberon", "bto"],
  "sampling site": ["uberon", "bto"],
  organ: ["uberon"],
  developmentalstage: ["uberon", "efo"],
  "developmental stage": ["uberon", "efo"],
  sex: ["pato"],
  phenotype: ["pato", "efo"],
  ancestrycategory: ["hancestro"],
  "ancestry category": ["hancestro"],
  sampletype: ["pride"],
  "sample type": ["pride"],
  compound: ["chebi", "ncit", "efo"],
  "treatment response": ["ncit"],
  "treatment status": ["ncit"],
  "smoking status": ["ncit"],
  "genetic modification": ["efo"],
  genotype: ["efo", "geno"],
  strain: ["ncbitaxon"],
  "strain or breed": ["ncbitaxon"],
  environmentalSampleType: ["envo"],
  "environmental sample type": ["envo"],
  environmentalMedium: ["envo"],
  "environmental medium": ["envo"],
  environmentalMaterial: ["envo"],
  "environmental material": ["envo"],
  enrichmentProcess: ["sep", "obi"],
  "enrichment process": ["sep", "obi"],
};

const ONTOLOGY_DISPLAY_PREFIX: Record<string, string> = {
  bto: "BTO",
  chebi: "CHEBI",
  cl: "CL",
  clo: "CLO",
  doid: "DOID",
  efo: "EFO",
  envo: "ENVO",
  geno: "GENO",
  hancestro: "HANCESTRO",
  hp: "HP",
  mondo: "MONDO",
  ms: "MS",
  ncbitaxon: "NCBITaxon",
  ncit: "NCIT",
  obi: "OBI",
  pato: "PATO",
  pride: "PRIDE",
  sep: "SEP",
  uberon: "UBERON",
  unimod: "UNIMOD",
};

function cleanOntologyString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeLookupKey(value: string | undefined): string {
  return cleanOntologyString(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

function sampleColumnProperty(column: string | undefined): string {
  return cleanOntologyString(column).match(/^characteristics\[(.+)\]$/)?.[1] ?? cleanOntologyString(column);
}

function normalizeOntologyList(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => cleanOntologyString(value).toLowerCase()).filter(Boolean)));
}

export function formatOntologyPrefix(prefix: string): string {
  const normalized = cleanOntologyString(prefix).toLowerCase();
  return ONTOLOGY_DISPLAY_PREFIX[normalized] ?? cleanOntologyString(prefix).toUpperCase();
}

export function getSampleOntologyFieldOntologies(field: OntologyFieldDescriptor): string[] {
  const explicit = normalizeOntologyList(field.ontologies);
  if (explicit.length) return explicit;

  const candidates = [
    field.key,
    sampleColumnProperty(field.column),
    field.label,
  ].map(normalizeLookupKey).filter(Boolean);

  for (const candidate of candidates) {
    const match = SAMPLE_FIELD_ONTOLOGIES[candidate] ?? SAMPLE_FIELD_ONTOLOGIES[candidate.replace(/\s+/g, "")];
    if (match?.length) return match;
  }

  return [];
}

export async function searchOlsTerms(
  params: OntologySearchParams,
  options: OntologySearchOptions = {},
): Promise<OntologySearchResponse> {
  const query = cleanOntologyString(params.query);
  const ontologies = normalizeOntologyList(params.ontology);

  if (query.length < 2) {
    return {
      suggestions: [],
      totalCount: 0,
      hasMore: false,
      query,
      ontologies,
    };
  }

  const normalizedParams = { ...params, query, ontology: ontologies };
  const cacheKey = getCacheKey(normalizedParams);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return {
      suggestions: cached,
      totalCount: cached.length,
      hasMore: cached.length >= (params.rows ?? DEFAULT_ROWS),
      query,
      ontologies,
    };
  }

  const url = buildOlsSearchUrl(normalizedParams);
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    throw new Error(`OLS API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const suggestions = mapOlsResponse(data, normalizedParams);
  addToCache(cacheKey, suggestions);

  return {
    suggestions,
    totalCount: Number(data?.response?.numFound) || suggestions.length,
    hasMore: (Number(data?.response?.numFound) || 0) > suggestions.length,
    query,
    ontologies,
  };
}

function buildOlsSearchUrl(params: OntologySearchParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set("q", params.query);
  searchParams.set("rows", String(params.rows ?? DEFAULT_ROWS));

  for (const ontology of normalizeOntologyList(params.ontology)) {
    searchParams.append("ontology", ontology);
  }

  if (params.exact) searchParams.set("exact", "true");
  if (params.type) searchParams.set("type", params.type);

  searchParams.set("fieldList", "id,iri,short_form,obo_id,label,description,ontology_prefix,synonym");
  searchParams.set("queryFields", "label,synonym,short_form,obo_id");
  searchParams.set("highlight", "true");

  return `${OLS_BASE_URL}/select?${searchParams.toString()}`;
}

function mapOlsResponse(data: unknown, params: OntologySearchParams): OntologyLookupTerm[] {
  const docs = Array.isArray((data as { response?: { docs?: unknown[] } })?.response?.docs)
    ? (data as { response: { docs: unknown[] } }).response.docs
    : [];

  const terms: OntologyLookupTerm[] = [];
  for (const rawDoc of docs) {
    const doc = rawDoc as Record<string, unknown>;
    const label = cleanOntologyString(doc.label);
    const id = normalizeOlsAccession(doc);
    const ontologyPrefix = cleanOntologyString(doc.ontology_prefix) || id.split(":", 1)[0];
    if (!label || !id) continue;

    const description = Array.isArray(doc.description)
      ? cleanOntologyString(doc.description[0])
      : cleanOntologyString(doc.description);
    const synonyms = Array.isArray(doc.synonym)
      ? doc.synonym.map(cleanOntologyString).filter(Boolean)
      : [];

    terms.push({
      id,
      label,
      iri: cleanOntologyString(doc.iri),
      ontologyPrefix: formatOntologyPrefix(ontologyPrefix),
      description: description || undefined,
      synonyms,
      isExactMatch: Boolean(params.exact) || label.toLowerCase() === params.query.toLowerCase(),
    });
  }

  return terms;
}

function normalizeOlsAccession(doc: Record<string, unknown>): string {
  const oboId = cleanOntologyString(doc.obo_id);
  if (oboId) return normalizeAccessionPrefix(oboId);

  const shortForm = cleanOntologyString(doc.short_form);
  if (shortForm) return normalizeAccessionPrefix(shortForm.replace(/^([A-Za-z][A-Za-z0-9]*)_(.+)$/, "$1:$2"));

  return normalizeAccessionPrefix(cleanOntologyString(doc.id));
}

function normalizeAccessionPrefix(accession: string): string {
  const match = accession.match(/^([^:]+):(.+)$/);
  if (!match) return accession;
  return `${formatOntologyPrefix(match[1])}:${match[2]}`;
}

function getCacheKey(params: OntologySearchParams): string {
  return JSON.stringify({
    query: cleanOntologyString(params.query).toLowerCase(),
    ontology: normalizeOntologyList(params.ontology).sort(),
    exact: Boolean(params.exact),
    rows: params.rows ?? DEFAULT_ROWS,
    type: params.type,
  });
}

function getFromCache(key: string): OntologyLookupTerm[] | null {
  const entry = ontologySearchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    ontologySearchCache.delete(key);
    return null;
  }
  return entry.value;
}

function addToCache(key: string, suggestions: OntologyLookupTerm[]): void {
  ontologySearchCache.set(key, { value: suggestions, timestamp: Date.now() });
  if (ontologySearchCache.size > CACHE_LIMIT) {
    const firstKey = ontologySearchCache.keys().next().value;
    if (firstKey) ontologySearchCache.delete(firstKey);
  }
}

async function fetchWithTimeout(url: string, options: OntologySearchOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  if (options.signal?.aborted) controller.abort();

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}
