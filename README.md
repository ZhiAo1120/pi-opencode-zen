# pi-opencode-zen

Use **OpenCode Zen free-tier** models from [Pi](https://pi.dev) — no proxy process, no reverse
proxy, no real API key.

[English](README.md) · [简体中文](README.zh-CN.md)

> ## ⚠️ Read this first
>
> The Zen free tier is documented as usable *from within OpenCode only*. This extension makes
> Pi's requests look like the official OpenCode client's. That is a terms-of-service grey area,
> and OpenCode says traffic is monitored for abuse.
>
> Realistically: expect `429` rate limiting (it already happens on most models) and, in the worst
> case, an IP block. This project is **not affiliated with OpenCode or Pi**. Use it at your own
> risk, and prefer the paid OpenCode Go plan (Pi is a validated client there) if you need
> something stable.

---

## What it does

The Zen free endpoint accepts a request only if it *looks* like the official client. A plain
OpenAI-shaped request is rejected:

```
403 {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode."}}
```

The gate is a request-shape check, not a key check. Pi sends the right shape for normal turns but
not for everything, so this extension:

- registers an `opencode-zen` provider that delegates to Pi's built-in `openai-completions` API,
- injects the required shape into any request that is missing it,
- generates a fresh, format-valid session id per process.

The reason it is needed at all: **summarization / compaction** builds a request with messages but
**no tools**, which is exactly the shape the server refuses. Without the extension you get
`Summarization failed: 403 FreeTierError` in long sessions.

## Requirements

- Pi with extension + custom-provider support (tested on Pi 1.3.0, including the Percho desktop app).
- A network exit in a region the free tier serves. From a blocked region every model answers
  `403 RegionError` (see [Troubleshooting](#troubleshooting)).
- No OpenCode account or API key. The free tier authenticates with the literal string `public`.

## Install

**Option A — as a Pi package (recommended)**

```bash
pi install git:github.com/ZhiAo1120/pi-opencode-zen
```

**Option B — manual**

```bash
cp extensions/opencode-zen.ts ~/.pi/agent/extensions/
```

**Option C — one-off try, without installing**

```bash
pi -e ./extensions/opencode-zen.ts -p --model opencode-zen/cat-jam-free "hello"
```

Extensions load at startup: **restart Pi** (or the Percho app — it hosts Pi in-process) after
installing or editing the file.

## Configure

Add the provider to `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "opencode-zen": {
      "name": "OpenCode Zen (free)",
      "baseUrl": "https://opencode.ai/zen/v1",
      "api": "opencode-zen-api",
      "apiKey": "public",
      "models": [
        { "id": "cat-jam-free", "name": "cat-jam-free", "reasoning": true, "input": ["text"], "contextWindow": 262144, "maxTokens": 131072 },
        { "id": "longcat-2.5-preview-free", "name": "longcat-2.5-preview-free", "reasoning": true, "input": ["text"], "contextWindow": 1000000, "maxTokens": 131072 },
        { "id": "nemotron-3.5-lightning-free", "name": "nemotron-3.5-lightning-free", "reasoning": true, "input": ["text"], "contextWindow": 262144, "maxTokens": 262144 }
      ]
    }
  }
}
```

Two rules that matter:

- `"api": "opencode-zen-api"` must stay at **provider** level. Do not set `api` on individual
  models — that bypasses this extension and brings the 403 back.
- No headers needed. The extension sends `User-Agent` and the session headers itself. Never send
  `x-opencode-request` (a legacy header that causes an immediate 403).

## Verify

```bash
# provider and models are loaded
pi --list-models opencode-zen

# end to end
pi -p --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: ZEN-OK"

# the path that needs the extension: a tool-less request (this is compaction's shape)
pi -p --no-tools --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: NOTOOLS-OK"
```

Do **not** add `-ne` (`--no-extensions`) to these commands. It disables extension discovery, the
extension never loads, and a healthy setup looks broken. (Explicit `-e <path>` still works with
`-ne`, which is how the isolated check in `test/` was run.)

## Model availability

Measured 2026-10-16 from a US exit IP. This list changes without notice — treat it as a starting
point, not a promise.

| Status | Models |
|---|---|
| Works | `cat-jam-free` (262K/131K), `longcat-2.5-preview-free` (1M/131K), `nemotron-3.5-lightning-free` (262K/262K) |
| `429 FreeUsageLimitError` | `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `space-bunny-free`, `mimo-v2.6-flash-free`, `big-pickle`, `ll-alpha-free`, `nemotron-3.5-super-vl-free` |
| Wrong protocol, unusable here | `muse-spark-1.2/1.3-contributor-free` (responses API), `jev-1.13-free` (systemone API) |

The 429 group was checked against session reuse, IP blocking and region — none of them explained
it; those models were simply rate limited at the account-free-tier level.

## How it works

The free endpoint (`https://opencode.ai/zen/v1/chat/completions`, **not** `/inference/...`, which
is the paid Console layer) accepts a request only when every one of these holds:

| Condition | Value |
|---|---|
| Auth | `Authorization: Bearer public` |
| Body | `"stream": true` |
| Tools | function definitions named exactly `bash` **and** `read` |
| User-Agent | contains `opencode/<version>`, e.g. `opencode/1.18.31 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14` |
| Session | both `x-opencode-session` **and** `x-opencode-session-id`, same value |
| Session format | `^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$`, with the 12 hex digits matching `^[0-9a-f]{9}f[c-f][0-9a-f]$` |
| Forbidden | `x-opencode-request` — sending it forces a 403 |

The session format is the interesting one: the last three hex digits must land in `0xFC0..0xFFF`,
a decrementing-timestamp layout. UUIDs, rising counters and random hex are all rejected.

`newZenSessionId()` in [`extensions/opencode-zen.ts`](extensions/opencode-zen.ts) produces exactly
that layout. One id is generated per process, so separate Pi runs no longer share one identity.
`shapeZenPayload()` is idempotent: a request that already carries `bash` and `read` is passed
through with only `stream` forced on.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OPENCODE_ZEN_SESSION` | generated | Pin the session id, e.g. when you have one known to work. |

## Troubleshooting

| Symptom | Cause |
|---|---|
| `403 FreeTierError` | Request shape is wrong: tools missing, wrong User-Agent, malformed session id, or `x-opencode-request` was sent. |
| `403 RegionError` — *"This model is not available in your country"* | Your exit IP's region is not served. The region check runs **before** the shape check, so this error says nothing about the request shape. Every model fails the same way. Use an exit in a served region. |
| `429 FreeUsageLimitError` | Shape is fine; that model is rate limited for you. Try another model from the table above. |
| Still broken after an edit | The extension loads at startup. Restart Pi / Percho. |
| `Summarization failed: 403` in long sessions | The extension is not loaded. Check for a stale `-ne` in your aliases. |
| A tool-less run tries to call `bash`/`read` | Those are the injected placeholders, not real tools. Run with tools enabled. |

## Development

```bash
npm test          # unit tests: session-id shape, payload shaping, header wiring
```

The tests stub `@earendil-works/pi-ai` and import the extension directly, so they run without a Pi
installation. Verified end to end with a throwaway agent dir:

```bash
PI_CODING_AGENT_DIR=/tmp/zen-e2e pi -ne -e ./extensions/opencode-zen.ts \
  --list-models opencode-zen
```

## License

[MIT](LICENSE)
