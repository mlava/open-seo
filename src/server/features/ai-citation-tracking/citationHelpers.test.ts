import { describe, expect, it } from "vitest";
import { buildCitationRows, providersForPrompt } from "./citationHelpers";

const context = () => ({
  responseId: "response-1",
  projectId: "project-1",
  trackedDomains: new Set(["example.com"]),
});

function sources(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://site${index}.test/page`,
    title: `Source ${index}`,
  }));
}

describe("buildCitationRows", () => {
  it("caps rows per response so the atomic batch stays bounded", () => {
    // Each row is one statement in the response's batch. Before the cap (and
    // before one-statement-per-row) a 20-source answer bound 160 parameters in
    // a single insert and D1 rejected it, failing the whole prompt step.
    const rows = buildCitationRows(sources(200), context());
    expect(rows).toHaveLength(60);
    expect(rows.at(-1)?.citationOrder).toBe(59);
  });

  it("keeps citation order and flags tracked domains", () => {
    const rows = buildCitationRows(
      [
        { url: "https://other.test/a", title: "Other" },
        { url: "https://www.example.com/pricing", title: "Ours" },
      ],
      context(),
    );

    expect(rows.map((row) => row.citationOrder)).toEqual([0, 1]);
    expect(rows.map((row) => row.domain)).toEqual([
      "other.test",
      // www. is stripped so it matches the tracked alias.
      "example.com",
    ]);
    expect(rows.map((row) => row.isTrackedDomain)).toEqual([false, true]);
  });

  it("drops sources that are not parseable urls", () => {
    const rows = buildCitationRows(
      [
        { url: "not a url", title: "Bad" },
        { url: "https://good.test/x", title: "Good" },
      ],
      context(),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe("good.test");
  });

  it("returns nothing for an answer that cited no sources", () => {
    expect(buildCitationRows([], context())).toEqual([]);
  });
});

describe("providersForPrompt", () => {
  const configured = ["openai", "anthropic", "google"] as const;

  it("falls back to the project default when the prompt has no override", () => {
    expect(
      providersForPrompt({ providers: null }, ["openai", "google"], configured),
    ).toEqual(["openai", "google"]);
  });

  it("uses the prompt override when set", () => {
    expect(
      providersForPrompt(
        { providers: JSON.stringify(["anthropic"]) },
        ["openai"],
        configured,
      ),
    ).toEqual(["anthropic"]);
  });

  it("drops providers with no configured key so a revoked key degrades the run", () => {
    expect(
      providersForPrompt({ providers: null }, ["openai", "xai"], configured),
    ).toEqual(["openai"]);
  });
});
