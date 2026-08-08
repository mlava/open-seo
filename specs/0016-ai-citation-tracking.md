# 0016 — AI citation tracking: multi-provider, scheduled

## Problem

We already ask LLMs questions in two places, and neither answers "is our brand
being cited, and is that changing":

- **Prompt Explorer** (`/prompt-explorer`) runs one prompt across ChatGPT,
  Claude, Gemini and Perplexity side by side. Ad-hoc, R2-cached for 7 days,
  nothing persisted — you cannot compare this week to last.
- **Brand Lookup** adds share-of-voice and cited sources, still ad-hoc.

Both go through DataForSEO's `llm_responses` API, so every answer costs resold
credits and reflects DataForSEO's plumbing rather than the assistant's own.

Bing AI citations (specs/0015) covers the same question for Bing Copilot, but
only via manually uploaded CSVs, and only for Bing.

What is missing is a durable record: a fixed set of prompts, asked on a
schedule, against the assistants people actually use, stored so that
week-over-week movement is visible.

## Decision

A per-project tab (`/p/$projectId/ai-citation-tracking`) with a **prompt
registry**, a **weekly scheduled run**, and a **prompt × provider matrix** of
results that drills into the full answer and its cited sources.

Each assistant is called **directly, with the operator's own API key and that
provider's native web search**. Five assistants, each optional — the tab enables
whichever keys exist:

| Provider   | Secret                         | Default model (override)              |
| ---------- | ------------------------------ | ------------------------------------- |
| ChatGPT    | `OPENAI_API_KEY`               | `gpt-5` (`AI_CITATION_MODEL_OPENAI`)  |
| Claude     | `ANTHROPIC_API_KEY`            | `claude-sonnet-4-5` (`..._ANTHROPIC`) |
| Gemini     | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-3.5-flash` (`..._GOOGLE`)     |
| Perplexity | `PERPLEXITY_API_KEY`           | `sonar-pro` (`..._PERPLEXITY`)        |
| Grok       | `XAI_API_KEY`                  | `grok-4` (`..._XAI`)                  |

Models are env-overridable because provider catalogues churn faster than our
release cycle — `gemini-2.5-pro` was closed to new API keys mid-build, and a
wrong default should be a config change, not a deploy.

Prompt Explorer and Brand Lookup stay on DataForSEO. They answer a different
question — point at anything, right now — and nothing here replaces them.

## Search surfaces, via SerpApi

The five above are **assistants**. An AI answer rendered on a search results
page is a different surface, reaching different people, and three of those are
tracked too:

| Surface            | SerpApi engine                  |
| ------------------ | ------------------------------- |
| Google AI Overview | `google` → `google_ai_overview` |
| Google AI Mode     | `google_ai_mode`                |
| Bing Copilot       | `bing_copilot`                  |

None has a first-party API. Bing's Search APIs are retired (the docs now serve
from `/previous-versions/` flagged `is_retired`), there is no public Copilot
answers API, Bing Webmaster's AI performance report is CSV-only (specs/0015),
and Google publishes no AI Overview API. Scraping via SerpApi is the only route.

All three share one `SERPAPI_KEY`, so the key enables the set and the per-project
and per-prompt provider toggles decide which actually run.

**Cost is the real constraint, and it is not ours to meter.** SerpApi bills per
search: prompts × engines per run, plus one extra whenever an AI Overview
returns a `page_token` instead of an inline answer. Thirty-three prompts across
all three engines is ~99–132 searches per run, so a weekly schedule is
~430–570/month — past the 250/month free tier, and a single run exceeds its
50/hour throughput. Budget the plan against prompts × engines × runs before
enabling these.

## Why an aggregator here but not for the assistants

We hold `OPENROUTER_API_KEY` for the chat agents, and routing the assistants
through it would have been less code. It is the wrong tool for them: OpenRouter's
web search is its own Exa-based plugin, so the citations would measure
OpenRouter, not Perplexity or Gemini. The same objection retires DataForSEO.
Measuring an assistant means calling that assistant's own search.

That reasoning does **not** carry over to the search surfaces, and it is worth
being explicit about why, because the two look alike. There the objection was
that a first-party answer existed and the aggregator would substitute its own.
For AI Overview, AI Mode and Copilot there is no first-party answer to prefer,
and what SerpApi returns is the answer a searcher actually sees. Preferring a
reseller is the only option, not a compromise.

## Data model

Six tables, all `project_id`-scoped and cascade-deleted with the project.

- `ai_citation_tracking_configs`: one per project. `brand_aliases` (JSON array
  of domains), `providers` (JSON array of provider slugs — the project
  default), `schedule_enabled`, `next_run_at`.
- `ai_citation_tracking_prompts`: `config_id`, `label`, `prompt`, `enabled`,
  and a nullable `providers` override. Null means inherit the project default.
  Capped at 50 per project (`MAX_PROMPTS_PER_PROJECT`).
- `ai_citation_tracking_tags` / `ai_citation_tracking_prompt_tags`: free-text
  tags, many per prompt. Deliberately the same tag-table-plus-assignment-join
  shape as `saved_keyword_tags`, so both features share the normalisation
  helpers and the client chip and colour code.
- `ai_citation_tracking_runs`: `trigger` (manual | scheduled), `status`,
  `prompt_count`, `task_count` (prompt × provider pairs — the real unit of
  work and of spend), `succeeded_count`, `failed_count`.
- `ai_citation_tracking_responses`: one per `(run, prompt, provider)`, enforced
  by a unique index. `answer_text`, `brand_mentioned`, `model`, token counts,
  `error_message`.
- `ai_citation_tracking_citations`: `response_id`, `url`, `domain`, `title`,
  `citation_order`, `is_tracked_domain`.

Raw provider payloads are **not** stored. They were in the first cut and were
never read; across eight surfaces the volume is eight times worse for no benefit.
`answer_text` plus structured citations is the evidence.

## What counts as evidence

Two ways this feature can report a confident number that measures nothing. Both
were shipped and both had to be corrected against real scan data.

**An answer that cited nothing is not absence.** On one run, 28 of 32 ChatGPT
answers and 23 of 32 Claude answers returned no citations of _any_ domain — the
assistant answered from its own weights without searching. Folding those into
"no mention" turned silence into a measured zero, and "0 of 32 cited you" read
as a ranking result when it was an artifact. They are now a distinct
`ungrounded` state, excluded from the denominator: the summary reports cited-you
over _answers that cited anything_, and says how many cited nothing.

**A citation you cannot attribute is not a miss.** See `attributedDomain` below.

**A brand written as prose is still a mention.** Aliases are entered as domains
(`scholar-sidekick.com`) and `mentionRegex` matched them literally, so it only
ever fired when an answer printed the domain — which is when it was already
citing. `brand_mentioned` was therefore redundant with the citation count and
never once fired on an answer that named the brand without linking to it. That
is precisely the signal that would rescue an assistant which discusses you but
does not cite: on one run it fired on five rows, every one of which already had
a tracked citation, and zero times on ChatGPT. Multi-token brands now match
across any separator or none, so "Scholar Sidekick", "scholar-sidekick" and
"ScholarSidekick" all count.

When adding a rollup, ask what its denominator is, and when adding a signal, ask
whether it can ever fire independently of the ones you already have. All three
of these shipped looking correct.

`brand_mentioned` is computed from the answer prose using the same
`mentionRegex` Prompt Explorer uses (extracted to `shared/brand-mentions.ts`),
so the two AI tabs cannot drift on what "mentioned" means. Aliases are entered
as domains, so a prompt's leading label (`example` from `example.com`) is also
matched — assistants write prose, not hostnames.

## Execution model

A run is a Cloudflare Workflow: `planRun` → one step per prompt → `finalizeRun`.

- **One step per prompt**, not one per batch. A batch can be 50 prompts across
  8 surfaces; as a single step it would exceed any sane step timeout, and a
  retry would re-ask every provider from the top.
- **Providers within a prompt run concurrently** (`PROVIDER_CONCURRENCY = 5`)
  via `allSettled`. `all` rejects on the first failure while its siblings are
  still in flight, and the step retry then races those writes into
  duplicate-key errors.
- **Retries are idempotent.** Each step skips `(prompt, provider)` pairs that
  already have a row, so a retry after a partial pass never re-spends API
  budget.
- **A failed prompt step is logged and skipped.** It must not abort `run()`,
  or `finalizeRun` never executes and the run sits at `running` forever.
- **Totals are counted from stored rows** in `finalizeRun`, not from in-memory
  counters, so a run resumed across restarts still reports true totals.

The scheduler advances `next_run_at` _before_ dispatch, so a failing Workflow
cannot become a retry loop that repeatedly spends the API budget. Saving
settings does not re-arm the clock — only an enable/disable transition does.

## Platform constraints

Two Cloudflare limits shaped this design more than anything else, and both cost
real debugging time. Read this section before changing the runner.

**D1 caps bound parameters at ~100 per statement.** Documented in
`db/runBatch.ts` and `rank-tracking/snapshotQueries.ts`. This broke the feature
twice:

- _Write:_ citations were one multi-row insert at 8 parameters per row, so a
  20-source answer bound 160 and D1 rejected it. Now the response row and its
  citations go in a single ordered `runBatch` — one statement each, atomic on
  both dialects, FK order preserved. Atomicity also closes a hole where a
  stored answer kept its text but lost every source, and leaves nothing for a
  retry to collide with. Citations are capped at
  `MAX_CITATIONS_PER_RESPONSE = 60` to bound the batch.
- _Read:_ the overview fetched citations with `inArray(responseIds)`, and a
  132-response run bound 132 parameters, so the whole page failed to load. Now
  a join on `run_id`, which binds exactly one regardless of run size.

Never bind a parameter per row here. A full run is 400 responses (50 prompts x 8 surfaces).

**Subrequests are budgeted per Workflow instance, not per step.** Free allows
50 and that is also the hard maximum; Paid defaults to 10,000. Every `fetch`,
every D1 binding call and every hop in a redirect chain spends one, at roughly
a dozen per prompt — so on Free a sweep dies after six prompts regardless of
how the work is arranged.

`step.sleep` does **not** refill the budget; a sleeping instance merely stops
counting toward concurrency. An attempt to yield every three prompts changed
nothing: a 33-prompt sweep died after exactly six, twice, with the trace
confirming all ten sleeps ran. Nothing inside one instance changes the total.
This needs headroom in the budget (Workers Paid), or more instances. If a run
ever outgrows 10,000, raise `limits.subrequests` in `wrangler.jsonc` — note
that a value above 50 is rejected outright on Free.

## Provider quirks

- **Gemini** returns grounding links as `vertexaisearch.cloud.google.com`
  redirects, not destinations, so citations would never match a tracked domain.
  Resolved via `redirect: "manual"`, capped at `MAX_REDIRECTS_RESOLVED = 10`
  because each resolution is itself a subrequest. Past that cap — and whenever
  resolution fails — the link still points at Google's redirector, so
  `attributedDomain` falls back to the reference title, which Gemini sets to the
  site domain. Without that fallback every unresolved redirect was attributed to
  `vertexaisearch.cloud.google.com` and scored `isTrackedDomain: false`,
  undercounting Gemini against rows whose title plainly read as a tracked
  domain. The stored URL stays the redirect, since that is what Gemini gave us.
- **xAI** reports hits in the `web_search` tool output rather than as
  normalised `sources`, so extraction falls back to that shape before
  concluding a provider returned nothing.
- **OpenAI** is called with `store: false`. The Responses API retains answers
  by default, which contradicts a tab whose premise is private, project-scoped
  evidence.
- **Calls are independent.** Every request sends a bare prompt — no message
  history, no system prompt, no `previousResponseId` — so answers cannot
  contaminate each other across prompts, providers or runs.
- **Google AI Overview** usually arrives from the `google` engine as a
  `page_token` rather than an inline answer, and that token **expires about a
  minute after the search**. The follow-up therefore runs immediately in the
  same call, never deferred to another step. A query with no AI Overview at all
  is recorded as an empty answer rather than an error: Google declining to show
  one is itself the finding.
- **All three SerpApi engines share one response shape** — `text_blocks[]` and
  `references[]` — differing only in that the `google` engine nests them under
  `ai_overview`. Blocks nest (a list carries `list[]`, an expandable carries its
  own `text_blocks[]`) and only leaves hold `snippet`, so text extraction
  recurses. Timeouts **reject** rather than resolving, so they must reach the
  caller's catch to be recorded as a failed cell rather than killing the run.

**AI SDK version coupling:** `ai@6` requires `@ai-sdk/*@3`. The `@4` provider
line targets `ai@7` and pulls in a second `@ai-sdk/provider`, which makes every
provider tool fail to typecheck against nominally distinct `Tool` types.
`pnpm.overrides` pins `@ai-sdk/provider` and `@ai-sdk/provider-utils`.

**Provider SDKs are imported dynamically.** They sit on the eager denylist in
`vite-plugin-lean-worker-bundle.ts`; a static import passes typecheck and tests
and fails only at build.

## Surfaces

- **Matrix**: prompts × providers, with four states — cited a tracked domain,
  mentioned only, no mention, error — plus "not run" for pairs that never
  executed. Any cell opens the full answer and its sources. Tag chips filter
  the matrix; a run picker selects history.
- **Export**: CSV or Sheets, matching the PageSpeed and Bing export menus.
  Exports what is on screen, tag filter included. Pairs that never ran are
  included as `not run` with blank counts — a gap is evidence, and a blank must
  not read as a genuine zero.
- **MCP** (read-only, no credits): `list_ai_citation_prompts` returns prompts
  with tags and provider overrides, optionally filtered to one tag, plus every
  tag in use for discovery. `get_ai_citation_results` returns one row per
  prompt × assistant for a run, filterable by `promptId` or `tag`; `promptId`
  also returns each answer's cited URLs, which stay opt-in because a whole run
  is up to 400 answers.

Nav placement is **My Site**, not Research: this tracks the project's own brand
over time rather than pointing at anything on demand.

## Deployment

Provider keys are instance-wide Worker secrets, not per-project rows — the
tracker spends the operator's own budget rather than resold credits.

Note that `package.json` has two unrelated deploy paths: `deploy` runs
`wrangler deploy` configured entirely by `wrangler.jsonc`, while
`deploy:postgres` runs Alchemy. A deployment made with the former ignores
everything declared only in `alchemy.run.ts`, so on such an instance the
provider keys must be set with `wrangler secret put` and any
`limits.subrequests` change belongs in `wrangler.jsonc`.

## Out of scope

No per-project provider keys — this is an operator-funded feature, and storing
user API keys would change its security posture entirely. No cross-project
rollups. No automatic prompt suggestion. No competitor tracking beyond the
brand aliases already used for citation matching; share-of-voice against named
competitors is Brand Lookup's job today and would need a different data model
here.
