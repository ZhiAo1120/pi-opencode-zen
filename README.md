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
> Realistically: expect `429` — most free models are only served in limited quantity — and, in
> the worst case, an IP block. This project is **not affiliated with OpenCode or Pi**. Use it at
> your own risk, and prefer the paid OpenCode Go plan (Pi is a validated client there) if you need
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
- **A proxy whose exit sits in a region the free tier serves.** This is not optional from
  mainland China: on a CN exit IP *every* model answers
  `403 RegionError: This model is not available in your country`, however correct your
  configuration is. A US exit was measured working. The region check runs **before** the
  request-shape check, so a region error says nothing about your setup — bring the proxy up
  first, then test. See [Troubleshooting](#troubleshooting).
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

Want your coding agent to do all of this — extension, `models.json` and the CC Switch row? Paste
[`AGENT-SETUP.md`](AGENT-SETUP.md) into it. (That prompt is written in Chinese.)

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

## CC Switch

[CC Switch](https://github.com/farion1231/cc-switch) keeps a second copy of your Pi providers and
writes them into `models.json` when you switch. Both copies must agree, and they are keyed
differently, so it is worth knowing exactly where each one lives.

| | |
|---|---|
| Database | `~/.cc-switch/cc-switch.db` (SQLite) |
| Row | table `providers`, `id = 'opencode-zen'`, `app_type = 'pi'` |
| `settings_config` | the **provider object only** — `name`, `baseUrl`, `api`, `apiKey`, `headers`, `models` — not the whole `models.json` |
| Other columns | `name`, `category = 'custom'`, `icon = 'pi'`, `meta = '{}'`, `is_current = 0`, `in_failover_queue = 0`, `cost_multiplier = '1.0'` |

**Quit CC Switch before writing to the database.** The app holds its provider list in memory and
rewrites the file, so an edit made while it runs can be silently lost.

```bash
# back up first
cp ~/.cc-switch/cc-switch.db /tmp/cc-switch.db.bak-$(date +%s)

python3 - <<'PY'
import json, os, sqlite3, time

# The same provider object as the models.json snippet above.
provider = {
    "name": "OpenCode Zen (free)",
    "baseUrl": "https://opencode.ai/zen/v1",
    "api": "opencode-zen-api",
    "apiKey": "public",
    "models": [
        {"id": "cat-jam-free", "name": "cat-jam-free", "reasoning": True, "input": ["text"], "contextWindow": 262144, "maxTokens": 131072},
        {"id": "longcat-2.5-preview-free", "name": "longcat-2.5-preview-free", "reasoning": True, "input": ["text"], "contextWindow": 1000000, "maxTokens": 131072},
        {"id": "nemotron-3.5-lightning-free", "name": "nemotron-3.5-lightning-free", "reasoning": True, "input": ["text"], "contextWindow": 262144, "maxTokens": 262144},
    ],
}

db = os.path.expanduser("~/.cc-switch/cc-switch.db")
con = sqlite3.connect(db)
con.execute(
    """INSERT INTO providers
       (id, app_type, name, settings_config, category, created_at, icon, meta,
        is_current, in_failover_queue, cost_multiplier)
       VALUES ('opencode-zen', 'pi', 'OpenCode Zen (free)', ?, 'custom', ?, 'pi', '{}', 0, 0, '1.0')
       ON CONFLICT(id, app_type) DO UPDATE SET
         name = excluded.name,
         settings_config = excluded.settings_config,
         category = excluded.category""",
    (json.dumps(provider, ensure_ascii=False), int(time.time() * 1000)),
)
con.commit()
con.close()
print("cc-switch row written")
PY
```

Check that the two copies match:

```bash
python3 - <<'PY'
import json, os, sqlite3
db = os.path.expanduser("~/.cc-switch/cc-switch.db")
row = sqlite3.connect(f"file:{db}?mode=ro", uri=True).execute(
    "select settings_config from providers where id='opencode-zen' and app_type='pi'").fetchone()
models = json.load(open(os.path.expanduser("~/.pi/agent/models.json")))
print("in sync:", json.loads(row[0]) == models["providers"]["opencode-zen"])
PY
```

CC Switch is optional. Pi reads `models.json` directly, so the provider block alone is enough —
the row only matters if you switch providers through the app.

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
| `429 FreeUsageLimitError` | `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `space-bunny-free`, `mimo-v2.6-flash-free`, `big-pickle`, `ll-alpha-free`, `nemotron-3.5-super-vl-free` — **served in limited quantity** |
| Wrong protocol, unusable here | `muse-spark-1.2/1.3-contributor-free` (responses API), `jev-1.13-free` (systemone API) |

The 429 group is a supply limit, not your usage: those models are only served in limited quantity
on the free tier, so they are often unavailable no matter who asks. Ruled out by experiment:
session reuse (a fresh session id changed nothing), IP blocking (other models answered 200 from the
same IP), and region (the exit was in the US).

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
| `429 FreeUsageLimitError` | Shape is fine; that model is out of free capacity — it is served in limited quantity. Try another model from the table above, or come back later. |
| Still broken after an edit | The extension loads at startup. Restart Pi / Percho. |
| `Summarization failed: 403` in long sessions | The extension is not loaded. Check for a stale `-ne` in your aliases. |
| A tool-less run tries to call `bash`/`read` | Those are the injected placeholders, not real tools. Run with tools enabled. |

## Development

```bash
npm test          # unit tests: session-id shape, payload shaping, header wiring
```

The tests stub `@earendil-works/pi-ai` and import the extension directly, so they run without a Pi
installation. Verified against the live endpoint on 2026-10-16 (US exit IP), with the extension
loaded from the repository path and a throwaway agent dir:

```bash
PI_CODING_AGENT_DIR=/tmp/zen-e2e pi -ne -e ./extensions/opencode-zen.ts --list-models opencode-zen
# -> provider opencode-zen / model cat-jam-free listed

pi -p --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: ZEN-OK"
# -> ZEN-OK

pi -p --no-tools --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: NOTOOLS-OK"
# -> NOTOOLS-OK   (proves the injected shape passes the gate on a tool-less request)
```

## Special thanks

[![LINUX DO](https://img.shields.io/badge/LINUX--DO-Community-blue.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg%2BPGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8%2BPHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4%3D&style=flat)](https://linux.do/)

Thanks to the [LINUX DO](https://linux.do) community for the support.

## License

[MIT](LICENSE)
