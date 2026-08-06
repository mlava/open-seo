import { describe, expect, it } from "vitest";
import { parseOpenAiCitationResponse } from "./openaiCitationClient";

describe("parseOpenAiCitationResponse", () => {
  it("preserves output text and deduplicates URL annotations and search sources", () => {
    const result = parseOpenAiCitationResponse(
      {
        model: "gpt-5",
        usage: { input_tokens: 12, output_tokens: 34 },
        output: [
          {
            type: "web_search_call",
            action: {
              sources: [
                { type: "url", url: "https://example.com/guide" },
                { type: "url", url: "https://other.example/source" },
              ],
            },
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "A concise answer.",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/guide",
                    title: "Example guide",
                  },
                ],
              },
            ],
          },
        ],
      },
      "fallback-model",
    );

    expect(result).toMatchObject({
      answerText: "A concise answer.",
      model: "gpt-5",
      inputTokens: 12,
      outputTokens: 34,
    });
    expect(result.citations).toEqual([
      { url: "https://example.com/guide", title: "Example guide" },
      { url: "https://other.example/source", title: null },
    ]);
  });
});
