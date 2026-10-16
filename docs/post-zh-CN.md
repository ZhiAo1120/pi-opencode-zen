# Pi + CC Switch 用上 OpenCode 免费模型

> **一句话**：给 Pi 装一个扩展，就能直接调用 OpenCode Zen 的免费模型 —— 不需要中间代理进程，
> 不需要反代，也不需要真的 API key。
>
> 仓库（MIT）：<https://github.com/ZhiAo1120/pi-opencode-zen>

---

## 先说清楚三件事

1. **大陆出口 IP 用不了。** 必须挂代理，且出口要落在免费层服务的地区（实测美国可用）。
   大陆 IP 下无论配置多正确，所有模型都返回 `403 RegionError`。
2. **免费层是「限量提供」的。** 大多数模型会返回 `429 FreeUsageLimitError`，这是服务侧放量有限，
   不是你的用量问题。目前稳定可用的是 3 个（见下表）。
3. **这是条款擦边球。** 官方明确说免费层只给 OpenCode 客户端用，且会监控滥用流量。风险自负，
   要稳定请用付费的 OpenCode Go 订阅。

---

## 为什么需要一个插件

OpenCode 的免费端点不在常规 API 上，而是 `https://opencode.ai/zen/v1/chat/completions`
（`/inference/...` 是付费 Console 层）。它**不靠密钥校验，靠请求形状校验** —— 形状不对就是：

```
403 {"type":"error","error":{"type":"FreeTierError",
     "message":"OpenCode's free tier can only be used from within OpenCode."}}
```

形状要求（全部同时满足）：

| 条件 | 值 |
|---|---|
| 认证 | `Authorization: Bearer public`（免费层不需要真 key） |
| body | `"stream": true` |
| tools | 必须包含**恰好叫 `bash` 和 `read`** 的函数定义 |
| User-Agent | 含 `opencode/<版本>`，如 `opencode/1.18.31 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14` |
| 会话头 | `x-opencode-session` **和** `x-opencode-session-id` 两个都要发，值相同 |
| 会话格式 | `^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$`，且 12 位 hex 要匹配 `^[0-9a-f]{9}f[c-f][0-9a-f]$` |
| 禁止 | `x-opencode-request` —— 发了直接 403 |

会话格式那条最讲究：后三位 hex 必须落在 `0xFC0..0xFFF`（递减时间戳布局）。UUID、递增计数器、
纯随机 hex 全都会被拒。

**Pi 的常规对话形状是对的**（Pi 的内置工具本来就叫 `bash` 和 `read`），但**摘要 / 压缩
（compaction）发的请求只有 messages、没有 tools** —— 正好是服务端拒绝的形状。所以长会话里会
出现 `Summarization failed: 403 FreeTierError`。

这就是插件要做的事：**给任何缺少形状的请求补上形状**，其余原样交给 Pi 内置的
`openai-completions` 实现。

---

## 前置条件

- Pi（CLI 或 Percho 桌面端都行，实测 Pi 1.3.0）
- **一个出口在服务地区的代理** —— 大陆用户这一步不可跳过
- CC Switch（可选。它只是帮你管理 provider；Pi 直接读 `models.json` 也能用）

## 三步搞定

### 1. 装扩展

```bash
pi install git:github.com/ZhiAo1120/pi-opencode-zen
```

装不了就手动拷贝：

```bash
git clone https://github.com/ZhiAo1120/pi-opencode-zen /tmp/pi-opencode-zen
cp /tmp/pi-opencode-zen/extensions/opencode-zen.ts ~/.pi/agent/extensions/
```

> 扩展在**启动时**加载。用 Percho 的话要**重启整个 App**（Percho 是进程内承载 Pi 的）。

### 2. 配 `~/.pi/agent/models.json`

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

- `"api": "opencode-zen-api"` 只能写在 **provider 级**。给单个 model 写 `api` 会绕过扩展，403 立刻回来。
- 不需要写任何 headers，插件自己会发。**永远别发** `x-opencode-request`。

### 3. 配 CC Switch（可选）

CC Switch 会在切换供应商时把它自己那份 provider 写进 `models.json`，所以同一份配置存了两处，
**结构还不一样**：

| | |
|---|---|
| 数据库 | `~/.cc-switch/cc-switch.db`（SQLite） |
| 行 | `providers` 表，`id = 'opencode-zen'`，`app_type = 'pi'`，主键 `(id, app_type)` |
| `settings_config` | **只放 provider 对象本身**（`name`/`baseUrl`/`api`/`apiKey`/`models`），**不是**整个 `models.json` |
| 其他列 | `name`、`category = 'custom'`、`icon = 'pi'`、`meta = '{}'`、`is_current = 0`、`in_failover_queue = 0`、`cost_multiplier = '1.0'` |

⚠️ **改数据库前先退出 CC Switch** —— 它把 provider 列表放在内存里，退出时会重写数据库，
运行中改的内容会被默默覆盖。

写入脚本和一致性核对脚本都放在仓库 README 的 **CC Switch** 章节，可直接粘贴（我在数据库副本上
验证过幂等：重复执行不会产生重复行）。

### 懒人方案：丢给智能体

仓库里有一份 [`AGENT-SETUP.md`](https://github.com/ZhiAo1120/pi-opencode-zen/blob/main/AGENT-SETUP.md)，
是**写给智能体看的配置说明**。整份粘贴给你的编码智能体（Percho / Pi / 其他 CLI agent 都行），
它会自己完成：查地区 → 装扩展 → 备份并合并 `models.json` → 退出 CC Switch 后写数据库 → 跑验证
命令 → 报告结果。里面也写清了硬约束（先备份、只动 `opencode-zen`、不写真实 key、不替用户开代理）。

---

## 实测可用的模型

2026-10-16 从美国出口 IP 实测，列表随时会变：

| 状态 | 模型 |
|---|---|
| ✅ 可用 | `cat-jam-free`（262K/131K）、`longcat-2.5-preview-free`（1M/131K）、`nemotron-3.5-lightning-free`（262K/262K） |
| ⏳ 429（限量提供） | `deepseek-v4.1-flash-free`、`glm-5.3-flash-free`、`space-bunny-free`、`mimo-v2.6-flash-free`、`big-pickle`、`ll-alpha-free`、`nemotron-3.5-super-vl-free` |
| ❌ 协议不符 | `muse-spark-1.2/1.3-contributor-free`（responses 协议）、`jev-1.13-free`（systemone 协议） |

那批 429 做过对照实验：换全新会话 ID 仍 429、同 IP 下其他模型稳定 200、出口 IP 在美国 ——
都不是原因，就是服务侧限量放号。

---

## 踩坑清单

| 现象 | 原因 |
|---|---|
| `403 RegionError` | 出口地区不受服务。**地区校验先于形状校验**，所以这个错完全不能说明配置有问题，先查代理 |
| `403 FreeTierError` | 形状不对：扩展没加载、`api` 被写到 model 级、或发了 `x-opencode-request` |
| `429 FreeUsageLimitError` | 形状没问题，该模型限量提供，容量用尽 → 换模型或稍后再试 |
| 排查时用了 `-ne` | `-ne` = `--no-extensions`，扩展直接不加载，正常配置看起来就像坏的。**测 Zen 功能绝不能加 `-ne`** |
| 长会话报 `Summarization failed: 403` | 扩展没生效（同上） |
| 改了文件没反应 | 扩展启动时加载，重启 Pi / Percho |

验证命令（**不要加 `-ne`**）：

```bash
pi --list-models opencode-zen

pi -p --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: ZEN-OK"

# 关键：无工具请求（压缩就是这个形状），能回 NOTOOLS-OK 才说明扩展生效
pi -p --no-tools --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: NOTOOLS-OK"
```

---

## 关于风险，我把话说明白

这不是「破解」也不是「越权访问」—— 免费层本来就不需要真 key，我没有绕过任何认证。但它确实是
**按形状伪装成官方客户端**去用人家声明只给自家客户端用的额度，属于打条款擦边球，官方也明说会
监控滥用流量。实际后果：限流（已经在发生了）、极端情况封 IP。

所以：**别拿它跑批量任务、别做自动化高频调用**。要稳定，$10/月的 OpenCode Go 订阅才是正路
（Pi 在那里是官方认可的客户端）。

---

## 短版（发群 / 即刻 / V2EX 用）

> **Pi + CC Switch 用上 OpenCode 免费模型**
>
> 写了个 Pi 扩展，直连 OpenCode Zen 免费层，不需要中间代理进程、不需要真 key。
> 免费层是按「请求形状」放行的（要求 tools 里必须有 `bash`/`read`、特定 UA 和会话头格式），
> 而 Pi 的压缩请求不带 tools，必然 403 —— 扩展负责把形状补齐。
>
> 三个前提：① 大陆 IP 用不了，**必须挂代理**且出口在服务地区；② 免费模型是**限量提供**的，
> 多数会 429，目前稳定可用 3 个；③ 属于条款擦边球，风险自负。
>
> 仓库（MIT，含中英 README 和一份可直接丢给智能体的配置说明）：
> <https://github.com/ZhiAo1120/pi-opencode-zen>
