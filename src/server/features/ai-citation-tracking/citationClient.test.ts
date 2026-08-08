import { describe, expect, it } from "vitest";
import { extractSources, resolveGroundingRedirects } from "./citationClient";

describe("extractSources", () => {
  it("keeps url sources, drops non-url sources, and dedupes by url", () => {
    const sources = extractSources({
      sources: [
        {
          sourceType: "url",
          url: "https://example.com/guide",
          title: "Example guide",
        },
        // Same URL again: keeps the first title rather than the later one.
        {
          sourceType: "url",
          url: "https://example.com/guide",
          title: "Duplicate",
        },
        { sourceType: "document", title: "A document" },
        { sourceType: "url", url: "https://other.example/source" },
      ],
      staticToolResults: [],
    });

    expect(sources).toEqual([
      { url: "https://example.com/guide", title: "Example guide" },
      { url: "https://other.example/source", title: null },
    ]);
  });

  it("falls back to web_search tool output when the provider reports no sources", () => {
    // xAI returns its hits in the tool result rather than as normalised sources.
    const sources = extractSources({
      sources: [],
      staticToolResults: [
        {
          output: {
            query: "best doi lookup tools",
            sources: [
              { title: "Crossref", url: "https://crossref.org", snippet: "" },
              { url: "https://example.org/a", snippet: "" },
            ],
          },
        },
      ],
    });

    expect(sources).toEqual([
      { url: "https://crossref.org", title: "Crossref" },
      { url: "https://example.org/a", title: null },
    ]);
  });

  it("ignores malformed tool output instead of throwing", () => {
    const sources = extractSources({
      sources: [],
      staticToolResults: [
        { output: null },
        { output: { sources: "not an array" } },
        { output: { sources: [{ noUrl: true }, null] } },
      ],
    });

    expect(sources).toEqual([]);
  });

  it("prefers normalised sources over the tool-output fallback", () => {
    const sources = extractSources({
      sources: [{ sourceType: "url", url: "https://primary.example" }],
      staticToolResults: [
        { output: { sources: [{ url: "https://ignored.example" }] } },
      ],
    });

    expect(sources).toEqual([{ url: "https://primary.example", title: null }]);
  });
});

describe("resolveGroundingRedirects", () => {
  const redirect = {
    url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    title: "example.com",
  };

  it("replaces a grounding redirect with its destination", async () => {
    const resolved = await resolveGroundingRedirects(
      [redirect],
      async () =>
        // A 302 whose Location is the real source.
        new Response(null, {
          status: 302,
          headers: { location: "https://example.com/real-page" },
        }),
    );

    expect(resolved).toEqual([
      { url: "https://example.com/real-page", title: "example.com" },
    ]);
  });

  it("keeps the original url when resolution fails", async () => {
    const resolved = await resolveGroundingRedirects([redirect], async () => {
      throw new Error("network down");
    });

    expect(resolved).toEqual([redirect]);
  });

  it("leaves non-redirect sources untouched without fetching", async () => {
    let calls = 0;
    const direct = { url: "https://example.com/page", title: null };
    const resolved = await resolveGroundingRedirects([direct], async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    });

    expect(resolved).toEqual([direct]);
    expect(calls).toBe(0);
  });
});
