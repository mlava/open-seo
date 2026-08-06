import { getOptionalEnvValue } from "@/server/lib/runtime-env";

export class AiCitationTrackingNotConfiguredError extends Error {
  constructor() {
    super("OpenAI citation tracking is not configured on this instance");
    this.name = "AiCitationTrackingNotConfiguredError";
  }
}

type Citation = { url: string; title: string | null };
export type OpenAiCitationResult = {
  answerText: string;
  citations: Citation[];
  rawResponse: string;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value));
}

export function parseOpenAiCitationResponse(
  payload: unknown,
  model: string,
): OpenAiCitationResult {
  const record = asRecord(payload);
  const output = Array.isArray(record.output) ? record.output : [];
  const answerParts: string[] = [];
  const citations = new Map<string, Citation>();
  for (const item of output) {
    // A web_search_call has no message content, so collect its sources before
    // inspecting message content below.
    const sources = asRecord(asRecord(item).action).sources;
    if (Array.isArray(sources)) {
      for (const source of sources) {
        const url = asRecord(source).url;
        if (typeof url === "string") citations.set(url, { url, title: null });
      }
    }
    const content = asRecord(item).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const contentPart = asRecord(part);
      if (typeof contentPart.text === "string")
        answerParts.push(contentPart.text);
      const annotations = Array.isArray(contentPart.annotations)
        ? contentPart.annotations
        : [];
      for (const annotation of annotations) {
        const citation = asRecord(annotation);
        if (
          citation.type === "url_citation" &&
          typeof citation.url === "string"
        )
          citations.set(citation.url, {
            url: citation.url,
            title: typeof citation.title === "string" ? citation.title : null,
          });
      }
    }
  }
  const usage = asRecord(record.usage);
  return {
    answerText:
      answerParts.join("\n\n") ||
      (typeof record.output_text === "string" ? record.output_text : ""),
    citations: [...citations.values()],
    rawResponse: JSON.stringify(payload),
    inputTokens:
      typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens:
      typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    model: typeof record.model === "string" ? record.model : model,
  };
}

export async function callOpenAiForCitationTracking(
  prompt: string,
): Promise<OpenAiCitationResult> {
  const apiKey = await getOptionalEnvValue("OPENAI_API_KEY");
  if (!apiKey) throw new AiCitationTrackingNotConfiguredError();
  const model =
    (await getOptionalEnvValue("OPENAI_CITATION_TRACKING_MODEL")) ?? "gpt-5";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // Keep only our private, project-scoped evidence rather than provider-side application state.
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [{ type: "web_search" }],
      store: false,
    }),
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = asRecord(asRecord(payload).error).message;
    throw new Error(
      typeof message === "string"
        ? message
        : `OpenAI request failed (${response.status})`,
    );
  }
  return parseOpenAiCitationResponse(payload, model);
}

export async function hasOpenAiCitationTrackingKey(): Promise<boolean> {
  return Boolean(await getOptionalEnvValue("OPENAI_API_KEY"));
}
