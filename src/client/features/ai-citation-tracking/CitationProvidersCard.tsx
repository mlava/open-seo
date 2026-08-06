import { KeyRound } from "lucide-react";
import {
  CITATION_PROVIDERS,
  CITATION_PROVIDER_LABELS,
  type CitationProvider,
} from "@/shared/ai-citation-providers";
import { ProviderBadge } from "./citationParts";

/**
 * The tracker calls each assistant's own API with the operator's key, so
 * "connected" means the Worker secret is present. Mirrors the connection cards
 * on the Stripe, PageSpeed and Bing tabs.
 */
const SECRET_NAMES: Record<CitationProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  xai: "XAI_API_KEY",
};

export function CitationProvidersCard({
  configured,
}: {
  configured: CitationProvider[];
}) {
  const missing = CITATION_PROVIDERS.filter(
    (provider) => !configured.includes(provider),
  );

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-base-content/50" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">AI providers</h2>
          <p className="mt-1 text-sm text-base-content/65">
            Each assistant is called with your own API key and its native web
            search. Set a key as a Worker secret to enable that provider.
          </p>

          {configured.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {configured.map((provider) => (
                <span
                  key={provider}
                  className="inline-flex items-center rounded-md bg-success/10 px-2 py-1 text-xs text-success"
                >
                  <ProviderBadge provider={provider} />
                </span>
              ))}
            </div>
          ) : (
            <div className="alert alert-warning mt-3">
              <span className="text-sm">
                No provider keys found. Set at least one of{" "}
                {CITATION_PROVIDERS.map((provider, index) => (
                  <span key={provider}>
                    {index > 0 ? ", " : ""}
                    <code>{SECRET_NAMES[provider]}</code>
                  </span>
                ))}{" "}
                to start collecting.
              </span>
            </div>
          )}

          {missing.length > 0 && configured.length > 0 ? (
            <p className="mt-3 text-xs text-base-content/50">
              Not configured:{" "}
              {missing
                .map(
                  (provider) =>
                    `${CITATION_PROVIDER_LABELS[provider]} (${SECRET_NAMES[provider]})`,
                )
                .join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
