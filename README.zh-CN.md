# pi-opencode-zen

在 [Pi](https://pi.dev) 里使用 **OpenCode Zen 免费层**模型 —— 不需要代理进程、不需要反代、不需要真 key。

[English](README.md) · [简体中文](README.zh-CN.md)

> ## ⚠️ 先读这段
>
> Zen 免费层的官方说法是「只能在 OpenCode 客户端内使用」。本扩展让 Pi 的请求看起来像官方
> OpenCode 客户端发出来的，属于打条款擦边球，官方也明说会监控滥用流量。
>
> 现实预期：`429`（多数免费模型是**限量提供**，容量用尽就 429），极端情况封 IP。本项目与
> OpenCode、Pi 官方均无关。**风险自负**；要稳定请用付费的 OpenCode Go 订阅（Pi 在那里是官方认可的客户端）。

---

## 它解决什么问题

Zen 免费端点只接受「长得像官方客户端」的请求。普通的 OpenAI 形状请求会被直接拒绝：

```
403 {"type":"error","error":{"type":"FreeTierError","message":"OpenCode's free tier can only be used from within OpenCode."}}
```

这道门槛是**请求形状校验，不是密钥校验**。Pi 的常规对话形状是对的，但不是所有请求都对，
所以本扩展：

- 注册一个 `opencode-zen` provider，把请求转交给 Pi 内置的 `openai-completions` 实现；
- 给任何缺少必要形状的请求补上形状；
- 每个进程生成一个新的、格式合法的会话 ID。

为什么非要这个扩展：**摘要 / 压缩（compaction）**发出的请求只有 messages、**没有 tools**，
而这正是服务端拒绝的形状。没有扩展，长会话里会出现 `Summarization failed: 403 FreeTierError`。

## 前置条件

- 支持扩展与自定义 provider 的 Pi（在 Pi 1.3.0 上验证，含 Percho 桌面端）。
- **必须配合代理，且出口要在免费层服务的地区。** 中国大陆出口 IP 下这一点不是可选项：
  无论配置多正确，**所有模型**都返回 `403 RegionError: This model is not available in your country`。
  实测美国出口可用。**地区校验先于形状校验执行**，所以地区报错完全不能说明你的配置有问题 ——
  先把代理开起来再测（见[故障排查](#故障排查)）。
- 不需要 OpenCode 账号或 API key：免费层用字面量 `public` 认证。

## 安装

**方式 A —— 作为 Pi 包安装（推荐）**

```bash
pi install git:github.com/ZhiAo1120/pi-opencode-zen
```

**方式 B —— 手动拷贝**

```bash
cp extensions/opencode-zen.ts ~/.pi/agent/extensions/
```

**方式 C —— 试用一次，不安装**

```bash
pi -e ./extensions/opencode-zen.ts -p --model opencode-zen/cat-jam-free "hello"
```

扩展在启动时加载：安装或改动文件后**重启 Pi**（Percho 是进程内承载 Pi，所以要重启整个 App）。

想让智能体帮你把扩展、`models.json`、CC Switch 一次性配好？把
[`AGENT-SETUP.md`](AGENT-SETUP.md) 整份粘贴给它即可。

## 配置

在 `~/.pi/agent/models.json` 里加上 provider：

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

两条必须遵守的规则：

- `"api": "opencode-zen-api"` 必须放在 **provider** 级。不要在单个 model 上写 `api`，
  那会绕过本扩展，403 立刻回来。
- 不需要写任何 headers。`User-Agent` 和会话头由扩展自己发送。**永远不要**发
  `x-opencode-request`（legacy 头，发了直接 403）。

## CC Switch

[CC Switch](https://github.com/farion1231/cc-switch) 会在切换供应商时把它自己那份 provider 写进
`models.json`，也就是说同一份配置存了两处。两处的**结构不一样**，写之前先看清：

| | |
|---|---|
| 数据库 | `~/.cc-switch/cc-switch.db`（SQLite） |
| 行 | `providers` 表，`id = 'opencode-zen'`，`app_type = 'pi'` |
| `settings_config` | **只放 provider 对象本身** —— `name`、`baseUrl`、`api`、`apiKey`、`headers`、`models`，**不是**整个 `models.json` |
| 其他列 | `name`、`category = 'custom'`、`icon = 'pi'`、`meta = '{}'`、`is_current = 0`、`in_failover_queue = 0`、`cost_multiplier = '1.0'` |

**改数据库前先退出 CC Switch**：应用把 provider 列表放在内存里，退出时会重写数据库，
运行中改的内容可能被默默覆盖掉。

```bash
# 先备份
cp ~/.cc-switch/cc-switch.db /tmp/cc-switch.db.bak-$(date +%s)

python3 - <<'PY'
import json, os, sqlite3, time

# 与上面 models.json 里完全相同的 provider 对象
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
print("cc-switch 行已写入")
PY
```

核对两处是否一致：

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

CC Switch 是可选的：Pi 直接读 `models.json`，只配 provider 块就能用；只有在 App 里切换
供应商时才需要那一行。

## 验证

```bash
# provider 和模型已加载
pi --list-models opencode-zen

# 端到端
pi -p --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: ZEN-OK"

# 真正需要扩展的那条路径：无工具请求（压缩就是这个形状）
pi -p --no-tools --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: NOTOOLS-OK"
```

这些命令**不要**加 `-ne`（`--no-extensions`）：它会关掉扩展发现，扩展根本没加载，
正常的配置看起来就像坏的。（显式 `-e <path>` 在 `-ne` 下仍然生效，`test/` 里的隔离验证就是这么跑的。）

## 模型可用性

2026-10-16 从美国出口 IP 实测。这个列表随时会变，只当起点，不当承诺。

| 状态 | 模型 |
|---|---|
| 可用 | `cat-jam-free` (262K/131K)、`longcat-2.5-preview-free` (1M/131K)、`nemotron-3.5-lightning-free` (262K/262K) |
| `429 FreeUsageLimitError` | `deepseek-v4.1-flash-free`、`glm-5.3-flash-free`、`space-bunny-free`、`mimo-v2.6-flash-free`、`big-pickle`、`ll-alpha-free`、`nemotron-3.5-super-vl-free` —— **限量提供** |
| 协议不对，这里用不了 | `muse-spark-1.2/1.3-contributor-free`（responses 协议）、`jev-1.13-free`（systemone 协议） |

那批 429 是**服务侧限量提供**造成的，不是你的用量问题：这些模型在免费层只放有限的量，谁问
都可能没有。已排除的原因（做过对照实验）：会话复用（换新会话 ID 仍 429）、IP 封禁（同 IP 下
其他模型稳定 200）、地区（出口 IP 在美国）。

## 实现原理

免费端点（`https://opencode.ai/zen/v1/chat/completions`，**不是** `/inference/...`，后者是付费
Console 层）要求以下条件**同时**成立：

| 条件 | 值 |
|---|---|
| 认证 | `Authorization: Bearer public` |
| body | `"stream": true` |
| tools | 必须包含**恰好叫 `bash` 和 `read`** 的函数定义 |
| User-Agent | 含 `opencode/<版本>`，例如 `opencode/1.18.31 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14` |
| 会话头 | `x-opencode-session` **和** `x-opencode-session-id` 两个都要发，值相同 |
| 会话格式 | `^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$`，且 12 位 hex 部分要匹配 `^[0-9a-f]{9}f[c-f][0-9a-f]$` |
| 禁止 | `x-opencode-request` —— 发了直接 403 |

会话格式是其中最讲究的一条：后三位 hex 必须落在 `0xFC0..0xFFF`（递减时间戳布局）。
UUID、递增计数器、纯随机 hex 都会被拒。

[`extensions/opencode-zen.ts`](extensions/opencode-zen.ts) 里的 `newZenSessionId()` 就是按这个
布局生成的。每个进程生成一个，因此不同的 Pi 运行不再共用同一个身份。`shapeZenPayload()`
是幂等的：已经带 `bash` 和 `read` 的请求原样通过，只强制打开 `stream`。

## 配置项

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `OPENCODE_ZEN_SESSION` | 自动生成 | 固定会话 ID，例如你手上有一个已验证可用的。 |

## 故障排查

| 现象 | 原因 |
|---|---|
| `403 FreeTierError` | 请求形状不对：缺 tools、User-Agent 不对、会话 ID 格式不对，或发了 `x-opencode-request`。 |
| `403 RegionError` —— *"This model is not available in your country"* | 出口 IP 所在地区不在服务范围。地区校验**先于**形状校验执行，所以这个错误完全不能说明请求形状是否有问题；所有模型会同样失败。换一个可服务的地区出口。 |
| `429 FreeUsageLimitError` | 形状没问题；该模型在免费层是**限量提供**，容量用尽。换上面表格里的其他模型，或稍后再试。 |
| 改了文件还是不行 | 扩展在启动时加载，重启 Pi / Percho。 |
| 长会话里 `Summarization failed: 403` | 扩展没加载。检查 alias 里是否残留了 `-ne`。 |
| 无工具运行时会尝试调用 `bash`/`read` | 那是注入的占位定义，不是真工具。带工具运行即可。 |

## 开发

```bash
npm test          # 单测：会话 ID 形状、payload 补齐、请求头装配
```

测试会 stub 掉 `@earendil-works/pi-ai` 并直接 import 扩展，所以不装 Pi 也能跑。
2026-10-16 用真实端点验证过（美国出口 IP，扩展从仓库路径加载 + 一次性 agent 目录）：

```bash
PI_CODING_AGENT_DIR=/tmp/zen-e2e pi -ne -e ./extensions/opencode-zen.ts --list-models opencode-zen
# -> 列出 provider opencode-zen / 模型 cat-jam-free

pi -p --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: ZEN-OK"
# -> ZEN-OK

pi -p --no-tools --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: NOTOOLS-OK"
# -> NOTOOLS-OK   （证明注入形状后无工具请求也能过门槛）
```

## 许可证

[MIT](LICENSE)
