import { describe, expect, it, vi } from "vitest";
import {
  fetchAiOverview,
  flattenTextBlocks,
  parseSerpApiAnswer,
} from "./serpapiClient";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("flattenTextBlocks", () => {
  it("walks paragraphs, list items and nested expandable blocks", () => {
    const text = flattenTextBlocks([
      { type: "paragraph", snippet: "Top level." },
      {
        type: "list",
        list: [{ snippet: "First item" }, { snippet: "Second item" }],
      },
      {
        type: "expandable",
        title: "More detail",
        text_blocks: [{ type: "paragraph", snippet: "Nested." }],
      },
    ]);

    expect(text).toEqual([
      "Top level.",
      "First item",
      "Second item",
      "More detail",
      "Nested.",
    ]);
  });

  it("ignores non-arrays and stops runaway nesting", () => {
    expect(flattenTextBlocks(undefined)).toEqual([]);
    expect(flattenTextBlocks("not an array")).toEqual([]);

    // 12 deep against a depth guard of 8.
    let deep: unknown = [{ snippet: "bottom" }];
    for (let i = 0; i < 12; i++) deep = [{ text_blocks: deep }];
    expect(flattenTextBlocks(deep)).toEqual([]);
  });
});

describe("parseSerpApiAnswer", () => {
  it("reads text_blocks and references nested under ai_overview", () => {
    const answer = parseSerpApiAnswer({
      ai_overview: {
        text_blocks: [{ type: "paragraph", snippet: "DOIs resolve via ..." }],
        references: [
          {
            index: 0,
            title: "Crossref",
            link: "https://crossref.org",
            source: "crossref.org",
          },
        ],
      },
    });

    expect(answer.answerText).toBe("DOIs resolve via ...");
    expect(answer.sources).toEqual([
      { url: "https://crossref.org", title: "Crossref" },
    ]);
  });

  it("reads them at the top level for AI Mode and Copilot", () => {
    const answer = parseSerpApiAnswer({
      text_blocks: [{ type: "paragraph", snippet: "Several tools exist." }],
      references: [
        { index: 0, link: "https://example.test", source: "Example" },
      ],
    });

    expect(answer.answerText).toBe("Several tools exist.");
    // Falls back to `source` when a reference carries no title.
    expect(answer.sources).toEqual([
      { url: "https://example.test", title: "Example" },
    ]);
  });

  it("dedupes repeated reference links and drops linkless ones", () => {
    const answer = parseSerpApiAnswer({
      references: [
        { link: "https://a.test", title: "First" },
        { link: "https://a.test", title: "Duplicate" },
        { title: "No link at all" },
      ],
    });

    expect(answer.sources).toEqual([{ url: "https://a.test", title: "First" }]);
  });

  it("falls back to a plain answer string when there are no blocks", () => {
    expect(parseSerpApiAnswer({ answer: "Short answer." }).answerText).toBe(
      "Short answer.",
    );
  });

  it("returns empty rather than throwing on an unrecognised payload", () => {
    expect(parseSerpApiAnswer(null)).toEqual({ answerText: "", sources: [] });
    expect(parseSerpApiAnswer({ organic_results: [] })).toEqual({
      answerText: "",
      sources: [],
    });
  });
});

describe("fetchAiOverview", () => {
  it("redeems a page_token against the dedicated engine", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: URL) => {
      calls.push(url.searchParams.get("engine") ?? "");
      if (url.searchParams.get("engine") === "google") {
        return json({ ai_overview: { page_token: "tok-123" } });
      }
      expect(url.searchParams.get("page_token")).toBe("tok-123");
      return json({
        ai_overview: {
          text_blocks: [{ snippet: "Full overview." }],
          references: [{ link: "https://cited.test", title: "Cited" }],
        },
      });
    });

    const answer = await fetchAiOverview("key", "best doi tools", fetchImpl);

    expect(calls).toEqual(["google", "google_ai_overview"]);
    expect(answer.answerText).toBe("Full overview.");
    expect(answer.sources).toEqual([
      { url: "https://cited.test", title: "Cited" },
    ]);
  });

  it("uses the inline overview when no page_token is returned", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        ai_overview: {
          text_blocks: [{ snippet: "Inline overview." }],
          references: [],
        },
      }),
    );

    const answer = await fetchAiOverview("key", "q", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(answer.answerText).toBe("Inline overview.");
  });

  it("treats a query with no AI Overview as an empty answer, not an error", async () => {
    const fetchImpl = vi.fn(async () => json({ organic_results: [] }));

    await expect(fetchAiOverview("key", "q", fetchImpl)).resolves.toEqual({
      answerText: "",
      sources: [],
    });
  });

  it("throws SerpApi's own error message so the cell shows it", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: "Your account has run out of searches." }, 401),
    );

    await expect(fetchAiOverview("key", "q", fetchImpl)).rejects.toThrow(
      "Your account has run out of searches.",
    );
  });
});
