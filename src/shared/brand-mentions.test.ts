import { describe, expect, it } from "vitest";
import {
  deriveBrandTerms,
  mentionRegex,
  textMentionsBrand,
} from "./brand-mentions";

describe("deriveBrandTerms", () => {
  it("keeps the domain and adds its registrable label", () => {
    expect(deriveBrandTerms(["scholar-sidekick.com"])).toEqual([
      "scholar-sidekick.com",
      "scholar-sidekick",
    ]);
  });

  it("takes the registrable label, not the leftmost one", () => {
    // "docs" as a brand term matched any answer mentioning documentation.
    expect(deriveBrandTerms(["docs.example.com"])).toEqual([
      "docs.example.com",
      "example",
    ]);
  });

  it("strips www and drops labels too short to be distinctive", () => {
    expect(deriveBrandTerms(["www.example.com"])).toEqual([
      "example.com",
      "example",
    ]);
    // The "co" of a co.uk-style suffix is not a brand.
    expect(deriveBrandTerms(["ab.co.uk"])).toEqual(["ab.co.uk"]);
  });

  it("ignores blanks", () => {
    expect(deriveBrandTerms(["  ", ""])).toEqual([]);
  });
});

describe("mentionRegex", () => {
  it("matches a hyphenated brand written as prose", () => {
    // The whole point: aliases are domains, answers are prose.
    const re = mentionRegex("scholar-sidekick");
    expect(re.test("I recommend Scholar Sidekick for that.")).toBe(true);
    expect(re.test("see scholar-sidekick docs")).toBe(true);
    expect(re.test("ScholarSidekick is neat")).toBe(true);
    expect(re.test("scholar_sidekick")).toBe(true);
  });

  it("still requires both tokens, in order", () => {
    const re = mentionRegex("scholar-sidekick");
    expect(re.test("a scholar wrote it")).toBe(false);
    expect(re.test("sidekick scholar")).toBe(false);
  });

  it("respects word boundaries", () => {
    expect(mentionRegex("acme").test("acmecorp")).toBe(false);
    expect(mentionRegex("acme").test("Acme, Inc.")).toBe(true);
  });

  it("handles brands ending in non-word characters", () => {
    expect(mentionRegex("C++").test("written in C++ mostly")).toBe(true);
    expect(mentionRegex("C++").test("C+++")).toBe(false);
    expect(mentionRegex("AT&T").test("AT&T said")).toBe(true);
  });

  it("matches the full domain form too", () => {
    expect(
      mentionRegex("scholar-sidekick.com").test("visit scholar-sidekick.com"),
    ).toBe(true);
  });
});

describe("textMentionsBrand", () => {
  const terms = deriveBrandTerms(["scholar-sidekick.com"]);

  it("fires on a prose mention with no link, which is the case that matters", () => {
    // An assistant that names you without citing you is exactly the signal the
    // citation count cannot see.
    expect(
      textMentionsBrand(
        "Tools like Scholar Sidekick verify DOIs against Crossref.",
        terms,
      ),
    ).toBe(true);
  });

  it("does not fire on unrelated prose", () => {
    expect(textMentionsBrand("Use Crossref or DataCite.", terms)).toBe(false);
  });

  it("is false with no terms configured", () => {
    expect(textMentionsBrand("Scholar Sidekick", [])).toBe(false);
  });
});
