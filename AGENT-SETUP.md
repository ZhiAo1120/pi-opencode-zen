# 给智能体的配置说明（整份粘贴即可）

> **用法**：把本文件**整份**发给你的编码智能体（Percho / Pi / 其他 CLI agent 都行），
> 它就能把扩展、`models.json`、CC Switch 三处一次配好。
> 这份 prompt 用中文写；英文读者请按 [README.md](README.md) 的 Install / Configure / CC Switch 章节手动操作。

---

## 任务

在这台机器上把 **OpenCode Zen 免费层**接入 Pi，使其可用并同步到 CC Switch。三件事：

1. 安装 Pi 扩展（补免费层要求的请求形状）。
2. 在 `~/.pi/agent/models.json` 里新增 `opencode-zen` provider。
3. 在 `~/.cc-switch/cc-switch.db` 里 upsert 对应的 provider 行。

完成后跑验证命令，并**贴出原始输出**。

## 直接采信的事实（不要重新推导、不要自己试错）

- 免费端点是 `https://opencode.ai/zen/v1/chat/completions`（**不是** `/inference/...`，那是付费 Console 层）。
- 认证用字面量 `public`，**不需要真 key**，也不需要 OpenCode 账号。
- 免费层按**请求形状**放行，不是按密钥。必需：`stream: true`；`tools` 里必须有**恰好叫 `bash` 和 `read`** 的函数定义；`User-Agent` 含 `opencode/<版本>`；`x-opencode-session` 与 `x-opencode-session-id` **两个头都要发且值相同**，形如 `ses_<12位hex><14位base62>`，且后三位 hex 必须落在 `0xFC0..0xFFF`。
- **禁止**发 `x-opencode-request`（legacy 头，发了直接 403）。
- Pi 的摘要/压缩请求**不带 tools**，必然撞门槛报 `403 FreeTierError` —— 这就是必须装扩展的原因。扩展会自动补形状，无需你改 Pi 源码。
- **地区门槛**：中国大陆出口 IP 下**所有模型**都返回 `403 RegionError`。**地区校验先于形状校验**，所以看到 RegionError 时不要怀疑配置，先查代理。实测美国出口可用。

## 步骤

### 1. 先确认出口地区（不通过就停下）

```bash
curl -s --max-time 15 https://ipinfo.io/json
```

- `"country": "CN"` 或地区不受支持 → **停止**，告诉用户「必须先开代理、出口要在服务地区」，不要继续折腾配置。
- 其他情况 → 继续。

### 2. 安装扩展（必须早于第 3 步）

```bash
pi install git:github.com/ZhiAo1120/pi-opencode-zen
```

装不了就用手动方式：

```bash
git clone https://github.com/ZhiAo1120/pi-opencode-zen /tmp/pi-opencode-zen
cp /tmp/pi-opencode-zen/extensions/opencode-zen.ts ~/.pi/agent/extensions/
```

> 若 `git clone` 因本机 `http.proxy` 指向未启动的本地端口而失败，**不要改用户的全局 git 配置**，
> 单次绕过即可：`git -c http.proxy= -c https.proxy= clone ...`

### 3. 合并 `models.json`（新增，不要覆盖）

文件：`~/.pi/agent/models.json`（若设了 `PI_CODING_AGENT_DIR`，则在该目录下）。
**先备份**，再用合并的方式加入下面这个块 —— **其他 provider 的内容一个字符都不要动**：

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
        { "id": "nemotron-3.5-lightning-free", "name": "nemotron-3.5-lightning-free", "reasoning": true, "input": ["text"], "contextWindow": 262144, "maxTokens": 262144 },
        { "id": "nemotron-3.5-super-vl-free", "name": "nemotron-3.5-super-vl-free", "reasoning": true, "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 131072 },
        { "id": "deepseek-v4.1-flash-free", "name": "deepseek-v4.1-flash-free", "reasoning": true, "input": ["text"], "contextWindow": 200000, "maxTokens": 32000 },
        { "id": "glm-5.3-flash-free", "name": "glm-5.3-flash-free", "reasoning": true, "input": ["text"], "contextWindow": 200000, "maxTokens": 32000 },
        { "id": "space-bunny-free", "name": "space-bunny-free", "reasoning": true, "input": ["text"], "contextWindow": 1048576, "maxTokens": 524288 },
        { "id": "mimo-v2.6-flash-free", "name": "mimo-v2.6-flash-free", "reasoning": true, "input": ["text"], "contextWindow": 200000, "maxTokens": 32000 },
        { "id": "big-pickle", "name": "big-pickle", "reasoning": true, "input": ["text"], "contextWindow": 200000, "maxTokens": 32000 }
      ]
    }
  }
}
```

三条硬规则：

- `"api": "opencode-zen-api"` 只能写在 **provider 级**。**不要**给单个 model 写 `api`，那会绕过扩展，403 立刻回来。
- 不要写 `x-opencode-request`。
- 不需要写 headers，`User-Agent` 和会话头由扩展自己发。

### 4. 配置 CC Switch

结构要点（写错就静默失效）：

| | |
|---|---|
| 数据库 | `~/.cc-switch/cc-switch.db`（SQLite） |
| 行 | `providers` 表，`id = 'opencode-zen'`，`app_type = 'pi'`，主键是 `(id, app_type)` |
| `settings_config` | **只放 provider 对象本身**（`name`/`baseUrl`/`api`/`apiKey`/`models`），**不是**整个 `models.json` |
| 其他列 | `name`、`category = 'custom'`、`icon = 'pi'`、`meta = '{}'`、`is_current = 0`、`in_failover_queue = 0`、`cost_multiplier = '1.0'` |

**先确认 CC Switch 应用已退出**（它把列表放内存里，退出时会重写数据库，运行中改的会被覆盖）：

```bash
pgrep -fl -i "cc-switch|ccswitch" || echo "not running"
cp ~/.cc-switch/cc-switch.db /tmp/cc-switch.db.bak-$(date +%s)
```

然后写入（与第 3 步**完全相同**的 provider 对象）：

```bash
python3 - <<'PY'
import json, os, sqlite3, time

provider = {
    "name": "OpenCode Zen (free)",
    "baseUrl": "https://opencode.ai/zen/v1",
    "api": "opencode-zen-api",
    "apiKey": "public",
    "models": [
        {"id": "cat-jam-free", "name": "cat-jam-free", "reasoning": True, "input": ["text"], "contextWindow": 262144, "maxTokens": 131072},
        {"id": "longcat-2.5-preview-free", "name": "longcat-2.5-preview-free", "reasoning": True, "input": ["text"], "contextWindow": 1000000, "maxTokens": 131072},
        {"id": "nemotron-3.5-lightning-free", "name": "nemotron-3.5-lightning-free", "reasoning": True, "input": ["text"], "contextWindow": 262144, "maxTokens": 262144},
        {"id": "nemotron-3.5-super-vl-free", "name": "nemotron-3.5-super-vl-free", "reasoning": True, "input": ["text", "image"], "contextWindow": 1048576, "maxTokens": 131072},
        {"id": "deepseek-v4.1-flash-free", "name": "deepseek-v4.1-flash-free", "reasoning": True, "input": ["text"], "contextWindow": 200000, "maxTokens": 32000},
        {"id": "glm-5.3-flash-free", "name": "glm-5.3-flash-free", "reasoning": True, "input": ["text"], "contextWindow": 200000, "maxTokens": 32000},
        {"id": "space-bunny-free", "name": "space-bunny-free", "reasoning": True, "input": ["text"], "contextWindow": 1048576, "maxTokens": 524288},
        {"id": "mimo-v2.6-flash-free", "name": "mimo-v2.6-flash-free", "reasoning": True, "input": ["text"], "contextWindow": 200000, "maxTokens": 32000},
        {"id": "big-pickle", "name": "big-pickle", "reasoning": True, "input": ["text"], "contextWindow": 200000, "maxTokens": 32000},
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

核对两处一致：

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

### 5. 验证（**绝对不要加 `-ne`**）

`-ne` = `--no-extensions`，会关掉扩展发现，配置正常也必然失败 —— 排查时加过它的人都会误判。

```bash
pi --list-models opencode-zen

pi -p --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: ZEN-OK"

pi -p --no-tools --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: NOTOOLS-OK"
```

期望：第一条列出 9 个模型；后两条分别回显 `ZEN-OK`、`NOTOOLS-OK`（第二条是关键 —— 它走的正是
需要扩展补形状的「无工具」路径）。

### 6. 重启提醒

扩展在**启动时**加载。若用户用的是 Percho 桌面端（进程内承载 Pi），改完必须**重启整个 App** 才生效。

## 失败时的判读（先看错误类型再动手）

| 报错 | 含义 | 该做什么 |
|---|---|---|
| `403 RegionError` | 出口地区不受服务 | 开代理 / 换出口。**不要**改配置 |
| `403 FreeTierError` | 形状不对 | 扩展没加载（检查有没有 `-ne`、有没有重启）；或 `api` 被写到了 model 级；或发了 `x-opencode-request` |
| `429 FreeUsageLimitError` | 形状没问题；该模型在免费层限量提供，此刻没有容量（很常见，同一批模型几分钟后就又能用） | 重试，或换另一个 —— 实测能用的有 `cat-jam-free`、`longcat-2.5-preview-free`、`nemotron-3.5-lightning-free`、`nemotron-3.5-super-vl-free`、`deepseek-v4.1-flash-free`、`glm-5.3-flash-free`、`space-bunny-free`、`mimo-v2.6-flash-free`、`big-pickle` |
| `410 ModelDeprecated` | 该模型已下架 | 从 `models.json` 里删掉它（例如 `ll-alpha-free`） |
| 长会话里 `Summarization failed: 403` | 扩展没生效 | 同上，重点查扩展是否加载 |

## 硬约束

- 改 `models.json` 和 CC Switch 数据库前**必须先备份**（`cp` 到 `/tmp/xxx.bak-$(date +%s)`）。
- **只做新增/更新 `opencode-zen`**，其他 provider 一律不动。
- **不要写入任何真实 API key**（免费层用 `public`）。
- 免费层是条款擦边球（官方声明只允许 OpenCode 客户端使用）：**只做本机配置，不要写自动化高频调用脚本**。
- 不要替用户开启代理软件或改用户的全局 git / 系统代理设置。

## 交付格式

报告时给出：

1. 改动的文件与备份路径；
2. `pi --list-models opencode-zen` 与两条 `-p` 验证命令的**原始输出**；
3. 「in sync」核对结果；
4. 未完成/未验证的部分（如果有），以及需要用户做的事（例如开代理、重启 Percho）。
