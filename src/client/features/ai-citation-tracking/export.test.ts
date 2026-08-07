import { describe, expect, it } from "vitest";
import { buildCitationExportRows, type ExportCell } from "./export";

const prompts = [
  {
    id: "p1",
    label: "Best DOI tools",
    prompt: "What are the best DOI lookup tools?",
    tags: [{ name: "competitors" }, { name: "tools" }],
  },
];
const providers = ["openai", "anthropic"] as const;

function cell(overrides: Partial<ExportCell>): ExportCell {
  return {
    promptId: "p1",
    provider: "openai",
    model: "gpt-5",
    brandMentioned: false,
    errorMessage: null,
    citationCount: 0,
    trackedCitationCount: 0,
    ...overrides,
  };
}

describe("buildCitationExportRows", () => {
  it("emits one row per prompt and provider", () => {
    const rows = buildCitationExportRows(prompts, providers, []);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row[2])).toEqual(["ChatGPT", "Claude"]);
  });

  it("distinguishes all four outcomes, including pairs that never ran", () => {
    const rows = buildCitationExportRows(
      [prompts[0], { ...prompts[0], id: "p2" }],
      ["openai", "anthropic"],
      [
        cell({ trackedCitationCount: 2, citationCount: 5 }),
        cell({ provider: "anthropic", brandMentioned: true, citationCount: 3 }),
        cell({ promptId: "p2", errorMessage: "rate limited" }),
        // p2 x anthropic deliberately absent.
      ],
    );

    expect(rows.map((row) => row[4])).toEqual([
      "cited you",
      "mentioned only",
      "error",
      "not run",
    ]);
  });

  it("carries counts, error text and tags through", () => {
    const [row] = buildCitationExportRows(
      prompts,
      ["openai"],
      [cell({ trackedCitationCount: 2, citationCount: 5 })],
    );

    expect(row[1]).toBe("competitors, tools");
    expect(row[5]).toBe(2);
    expect(row[6]).toBe(5);
    expect(row[8]).toBe("What are the best DOI lookup tools?");
  });

  it("leaves counts blank rather than zero for a pair that never ran", () => {
    const [row] = buildCitationExportRows(prompts, ["openai"], []);
    // A real zero and "no data" must not read the same in a spreadsheet.
    expect(row[5]).toBe("");
    expect(row[6]).toBe("");
  });
});
