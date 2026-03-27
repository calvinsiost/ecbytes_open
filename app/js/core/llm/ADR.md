# ADR 11: LLM Integration and Multi-Agent System

**Project**: ECBT -- Environmental & Occupational Core Byte Tools
**Title**: Multi-Provider LLM Client with Prompt Engineering, Command Execution, and Site Research
**Author**: Calvin Stefan Iost
**Date**: 2026
**Atualizado:** 2026-03-26
**Status**: Accepted

## Context

Environmental engineers need natural language interfaces to interact with complex
monitoring data -- adding observations, creating elements, analyzing trends, and
researching site conditions. The system must support multiple LLM providers,
structured command extraction from free-text input, specialized agent personas
for different regulatory frameworks, and automated site research via public APIs.

## Decision

### 1. Multi-Provider API Abstraction (client.js, providers.js)

A unified `sendMessage()` function abstracts five LLM providers (OpenAI, Claude,
Google Gemini, DeepSeek, Groq) behind a single interface. Provider-specific
differences are handled internally:

- **OpenAI-compatible**: Standard Bearer token auth (OpenAI, DeepSeek, Groq).
- **Claude**: x-api-key header with anthropic-version and direct browser access flag.
- **Google Gemini**: Query parameter authentication with parts-based content structure.

Vision support is integrated across all providers: images are sent as base64 data URLs
in provider-specific multimodal formats. API keys are stored in sessionStorage (not
localStorage) to prevent persistence across browser sessions.

### 2. Structured Prompt Builder (promptBuilder.js)

The system prompt is dynamically constructed by injecting the current model context:
all elements (with observation counts), campaigns (with dates), available parameters
(with SAO tier annotations when active), enabled element families, and measurement
units. This context-aware prompt enables the LLM to resolve ambiguous references
(e.g., "point 3" -> well-3) without round-trip clarification.

The prompt defines 6 core actions (ADD_OBSERVATION, ADD_ELEMENT, ADD_CAMPAIGN,
UPDATE_OBSERVATION, UPDATE_ELEMENT, UPDATE_CAMPAIGN) plus conditional tool actions
(ANALYZE_TRENDS, SUGGEST_SAMPLING, RUN_AUDIT, SITE_RESEARCH, POPULATE_FROM_RESEARCH,
CLEAR_MARKERS) that appear only when their corresponding tools are active. This
keeps the prompt within token limits by excluding unused action definitions.

### 3. JSON Response Parser with Repair (parser.js)

LLM responses are parsed through a multi-stage pipeline:

1. Direct JSON.parse attempt.
2. Markdown code block stripping and regex JSON extraction.
3. Truncated JSON repair: brace counting with string-awareness, trailing property
   removal, and progressive closing of unclosed braces.
4. Field-level regex recovery: extracts `confirmation`, `understood`, and `action`
   fields individually from severely truncated responses.
5. Conversational fallback: non-JSON text is wrapped as `{understood: false}`
   for display without error.

Reference resolution maps natural language to model entities: element references
by name, ID, or ordinal number; campaign references by name or index; parameter
references by ID or common name; unit references with micro-symbol normalization.

### 4. Command Executor (commandExecutor.js)

A handler registry maps action strings to async executor functions. Each handler
validates parameters, calls the appropriate manager module, updates UI state,
and returns structured results. The executor bridges the LLM's structured output
to the application's handler/manager architecture.

Advanced analytical actions include:

- **ANALYZE_TRENDS**: Time series regression (OLS, Mann-Kendall, Sen's Slope).
- **SUGGEST_SAMPLING**: Spatial coverage analysis with 3D marker visualization.
- **RUN_AUDIT**: ESG anti-greenwashing audit (Benford's Law, quality checks).
- **SITE_RESEARCH / POPULATE_FROM_RESEARCH**: Two-phase site data ingestion.

### 5. Multi-Agent Persona System (agents.js)

Six system agents provide domain-specific prompt specializations:

- **General Assistant**: Default, no additional prompt.
- **Regulatory (BR)**: CONAMA 420/396/430, CETESB, IBAMA, NBR 15.515 expertise.
- **Regulatory (US)**: EPA MCLs, RCRA, CERCLA, RSLs, ASTM E1527/E1903.
- **Regulatory (Intl)**: WHO, EU WFD, Stockholm Convention, ISO 14001/14040.
- **Campaign Manager**: Sampling protocols, QA/QC, chain of custody, purging criteria.
- **HSE**: NR-15/NR-9 (BR), OSHA PELs, NIOSH RELs, ISO 45001, risk matrices.

User-created agents are persisted in localStorage with full CRUD operations and
JSON export/import for sharing. The active agent's `systemPromptAddition` is
appended to the base prompt at runtime.

### 6. Public Data Site Research (siteResearch.js)

Three-source data aggregation for conceptual model construction:

- **Nominatim (OpenStreetMap)**: Forward and reverse geocoding with Brazilian
  locale preference.
- **IBGE API**: Municipality lookup with UF extraction from ISO 3166-2 codes
  and accent-normalized name matching.
- **Overpass API**: Nearby feature queries (water bodies, industries, fuel stations,
  schools, hospitals, protected areas, land use) within configurable radius.

The POPULATE_FROM_RESEARCH action creates model elements from research results,
sets UTM coordinates as project origin, and converts WGS84 feature positions to
relative coordinates. Append/replace modes protect existing data.

### 7. Chat Tools (chatTools.js)

A pluggable tool system adds behavioral and analytical capabilities to the chat.
Tools can inject prompt additions (e.g., Critical Review mode instructions),
register conditional actions, and provide UI panel integrations. Active tools
are tracked independently and their prompts are appended to the system prompt.

### 8. AI Engine Router (router.js, browserEngine.js, webllmEngine.js, localEngine.js, benchmark.js)

Four execution backends behind a unified `routeMessage()` interface:

- **Cloud** (EngineType.CLOUD): Existing multi-provider API abstraction (client.js).
  No changes to existing flow — router delegates directly to `sendMessage()`.
- **Browser** (EngineType.BROWSER): On-device inference via Transformers.js v4
  (`@huggingface/transformers@4.0.0-next.3`) with WebGPU acceleration (fallback:
  WASM/CPU). Uses ONNX Runtime Web. Models: Gemma 3 270M, Qwen 2.5 1.5B,
  LFM 2.5 1.2B Thinking, Llama 3.2 3B. CDN separate from `@xenova/transformers@2`
  used by recognition/. Singleton pipeline with Cache API for model weights.
  Browser, web-llm, and local engines use `buildLitePrompt()` (~500-800 tokens)
  instead of the full structured prompt (~5K-8K tokens).
- **Web-LLM** (EngineType.WEB_LLM): On-device inference via @mlc-ai/web-llm
  (MLC/TVM compiled models). WebGPU only (no WASM fallback). OpenAI-compatible
  chat API with native streaming. Models: Qwen 2.5 0.5B/1.5B, SmolLM2 1.7B,
  Llama 3.2 1B/3B, Phi 3.5 Mini. Positioned as offline assistant for simple queries.
  TVM compilation optimizes specifically for chat text-generation.
- **Local Server** (EngineType.LOCAL): OpenAI-compatible HTTP endpoint for Ollama,
  LM Studio, llama.cpp. Streaming via SSE. CORS error detection with user guidance.

The router normalizes all outputs to `{ content, provider, model, usage }` shape,
preserving full compatibility with the existing parser and command executor pipeline.
`processCommand()` changes one line: `sendMessage()` -> `routeMessage()`.

Streaming support via `routeMessageStream()` async generator enables token-by-token
display for browser and local engines. Cloud engine yields full response as single token.

Browser capability benchmark (`benchmark.js`) auto-detects WebGPU, GPU info, VRAM,
RAM, and device type, then recommends the optimal free model. The benchmark runs
when the user opens the browser engine configuration tab.

## Consequences

- Multi-provider support prevents vendor lock-in and allows cost optimization.
- Context-aware prompts enable single-turn command resolution without follow-up questions.
- The robust JSON parser handles the reality of LLM output variability and token truncation.
- Regulatory agents encode domain expertise that would otherwise require specialist training.
- Public API site research enables rapid conceptual model initialization from any address.
- Browser engine enables free, offline AI assistance without API keys or data leaving device.
- Local server engine supports power users running Ollama/LM Studio for custom models.
- Engine router is transparent to the rest of the system: agents, tools, and parser unchanged.

### 9. Lite Prompt for Browser/Local Engines (promptBuilder.js)

Small language models (1-3B parameters) have context windows of 2K-8K tokens. The full
system prompt (elements, campaigns, 90+ parameters, units, action definitions, examples)
occupies 5K-8K tokens, exceeding available space and causing "Prompt is too long" errors.

`buildLitePrompt()` provides a conversational-mode prompt (~500-800 tokens) that:

- Summarizes model context (counts only, not full listings)
- Removes action definitions, interpretation rules, JSON format, and examples
- Removes parameter/unit/family enumeration
- Removes professional validation and tool action sections
- Preserves agent specialization injection (if active)
- Instructs the model to respond conversationally, not in structured JSON

The router (`routeMessage`, `routeMessageStream`) automatically selects the lite prompt
for BROWSER, WEB_LLM, and LOCAL engines. Cloud engine continues using the full prompt.

**Model ID fix**: `LiquidAI/LFM2.5-1.2B-Thinking-WebGPU` (gated repo, 401 error) was
replaced with `LiquidAI/LFM2.5-1.2B-Thinking-ONNX` (public repo, `gated: false`).
CDN upgraded from `@huggingface/transformers@3` to `@4.0.0-next.3` to support the
`Lfm2ForCausalLM` architecture used by LiquidAI models.

**Gemma 2 2B removal**: `onnx-community/gemma-2-2b-it` (Google Gemma, gated license)
was replaced with `onnx-community/Qwen2.5-1.5B-Instruct` (Alibaba Qwen, Apache 2.0,
public repo). Google Gemma models require HuggingFace license acceptance and
authentication, incompatible with anonymous browser-based model loading.

**Gated model fallback**: `ensurePipeline()` now detects 401/Unauthorized errors and
automatically retries with the next available model in `BROWSER_MODELS`. This prevents
future gating changes from breaking the browser engine without code updates.

**OOM fallback**: `ensurePipeline()` detects out-of-memory errors (`std::bad_alloc`,
ONNX ERROR_CODE 6) and falls back to a **smaller** model (sorted by `vramGB`).
A session-level `Set` tracks failed models to prevent infinite retry loops.
If all models fail, throws a user-friendly error suggesting Cloud or Local engine.
Separate from gated fallback: `_findSmallerModel()` (OOM, size-ordered) vs
`_findFallbackModel()` (gated, circular order). OOM check runs first in the catch
block since it's the more critical failure mode.

**Self-hosted micro model**: `gemma-3-270m-it-ONNX` (270M params, q4f16, ~460 MB)
is hosted directly on the production server (Bluehost) instead of loading from
HuggingFace CDN. This is the smallest viable model and serves as last-resort OOM
fallback. Provisioned via `scripts/provision-models.sh` (one-time SSH command).
The deploy workflow excludes `models/` from rsync `--delete` so models persist
between code deploys. Transformers.js `allowLocalModels = true` with
`localModelPath = '/models/'` enables transparent local-first loading: models
self-hosted load from Bluehost, CDN models load from HuggingFace as before.

**Dynamic dtype**: Each model entry in `BROWSER_MODELS` can specify a `dtype`
field (e.g., `'q4f16'`, `'q4'`). The `ensurePipeline()` function reads this
field instead of using a hardcoded `'q4'`. Default remains `'q4'` for
backward compatibility. This enables per-model quantization optimization
(e.g., Gemma 270M uses q4f16 which is 45% smaller than q4 for this model).
