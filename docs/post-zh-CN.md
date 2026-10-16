# 在 Pi 里用 OpenCode 的免费模型（顺带 CC Switch 配置）

上周想把 OpenCode 的免费模型接进 Pi，本来以为改个 baseUrl 就完事，结果一路 403，折腾了两天
才摸清门槛到底卡在哪。踩的坑记在这，配置也整理成了一个扩展。

仓库：<https://github.com/ZhiAo1120/pi-opencode-zen>（MIT）

先把几个前提说了，免得白折腾：

- 大陆 IP 用不了，得挂代理，出口要在服务地区（我用的是美国出口）。
- 免费模型是限量提供的，大部分时候会返回 429，目前稳定能用的就 3 个。
- 这事属于打条款擦边球（官方说免费层只给 OpenCode 客户端用），风险自负。

---

## 403 的原因不是 key，是请求形状

免费端点不在常规 API 上，是 `https://opencode.ai/zen/v1/chat/completions`。
注意不是 `/inference/...`，那个是付费 Console 层。

它的放行规则跟密钥无关。免费层根本不需要真 key，认证头写 `Authorization: Bearer public` 就行。
它卡的是请求长什么样，形状不对就给你：

```
403 {"type":"error","error":{"type":"FreeTierError",
     "message":"OpenCode's free tier can only be used from within OpenCode."}}
```

具体要满足这些，缺一不可：

- 认证头 `Authorization: Bearer public`
- body 里必须 `"stream": true`
- `tools` 里必须有恰好叫 `bash` 和 `read` 的函数定义，名字大小写都敏感
- User-Agent 要含 `opencode/<版本>`，我用的是 `opencode/1.18.31 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14`
- `x-opencode-session` 和 `x-opencode-session-id` 两个头都要发，值还得一样
- 会话 ID 要匹配 `^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$`，而且那 12 位 hex 要匹配 `^[0-9a-f]{9}f[c-f][0-9a-f]$`
- 不能发 `x-opencode-request`，那是老版头，发了直接 403

最后那条会话 ID 最坑。后三位 hex 必须落在 `0xFC0..0xFFF` 区间，是个递减时间戳的布局。
我一开始用 UUID，403；换成递增的随机 hex，还是 403；最后照着开源实现的规则生成才对。
生成规则写成一行大概是这样：

```js
"ses_" + 9位随机hex + "f" + [c-f]中随机一位 + 随机hex + 14位base62
```

## 为什么还得写个扩展

Pi 正常聊天的时候形状是对的。Pi 内置工具本来就叫 `bash` 和 `read`，UA 和会话头也能在
models.json 里配上，所以一开始对话是通的。

问题出在摘要和压缩。Pi 做 compaction 的时候走的是另一条构造路径，发出去的请求只有 messages、
不带 tools。这一下就撞上门槛了，长会话里会看到 `Summarization failed: 403 FreeTierError`。

所以扩展干的事很简单：任何缺 tools 的请求，给它补上 `bash` 和 `read` 两个占位定义，再强制
打开 stream，其余原样交给 Pi 内置的 `openai-completions` 实现。已经带 tools 的请求不动它。

## 配置

### 1. 装扩展

```bash
pi install git:github.com/ZhiAo1120/pi-opencode-zen
```

装不上就手动拷：

```bash
git clone https://github.com/ZhiAo1120/pi-opencode-zen /tmp/pi-opencode-zen
cp /tmp/pi-opencode-zen/extensions/opencode-zen.ts ~/.pi/agent/extensions/
```

扩展是启动时加载的。如果你用 Percho 桌面端，得重启整个 App，因为 Percho 是把 Pi 跑在自己进程里。

### 2. 改 models.json

文件在 `~/.pi/agent/models.json`，加一个 provider 进去：

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

有个坑要注意：`"api": "opencode-zen-api"` 只能写在 provider 这一层。如果你给单个 model 也写一个
`api`，就把扩展绕过去了，403 立马回来。这个我踩过。

headers 不用写，扩展自己会发。

### 3. CC Switch（可选）

CC Switch 会在你切换供应商的时候，把它自己存的那份 provider 写进 models.json。也就是说同一份
配置存了两份，而且两边结构不一样，这个很容易写错：

- 数据库是 `~/.cc-switch/cc-switch.db`，SQLite
- 表是 `providers`，行靠 `id = 'opencode-zen'` 和 `app_type = 'pi'` 定位，主键是这两个字段的组合
- `settings_config` 字段里放的是 provider 对象本身，也就是 `name`/`baseUrl`/`api`/`apiKey`/`models` 这几个键，不是整个 models.json
- 其他字段跟着填：`name`、`category = 'custom'`、`icon = 'pi'`、`meta = '{}'`、`is_current = 0`、`in_failover_queue = 0`、`cost_multiplier = '1.0'`

写数据库之前一定要先退出 CC Switch。它把 provider 列表放在内存里，退出的时候会重写数据库，
你运行中改的内容会被它覆盖掉，白改。

写入脚本和一致性检查脚本我放在仓库 README 的 CC Switch 那一节了，可以直接复制。
那个脚本我在数据库副本上跑过，重复执行不会多出行。

其实 CC Switch 是可选的。Pi 直接读 models.json，只配 provider 也能用，只有你在 App 里切换
供应商时才需要那一行。

### 不想自己动手的话

仓库里有个 `AGENT-SETUP.md`，是写给智能体看的配置说明。整份复制给你的编码智能体
（Percho、Pi、其他 CLI agent 都行），它会自己去查地区、装扩展、备份并合并 models.json、
退出 CC Switch 后写数据库、跑验证命令，最后把结果贴给你。里面也写了硬约束，比如必须先备份、
只动 opencode-zen 这个 provider、不许写真实 key。

## 现在能用的模型

2026-10-16 从美国出口测的，随时会变：

| 状态 | 模型 |
|---|---|
| 能用 | `cat-jam-free`（262K/131K）、`longcat-2.5-preview-free`（1M/131K）、`nemotron-3.5-lightning-free`（262K/262K） |
| 429，限量提供 | `deepseek-v4.1-flash-free`、`glm-5.3-flash-free`、`space-bunny-free`、`mimo-v2.6-flash-free`、`big-pickle`、`ll-alpha-free`、`nemotron-3.5-super-vl-free` |
| 协议不对 | `muse-spark-1.2/1.3-contributor-free`（responses 协议）、`jev-1.13-free`（systemone 协议） |

那批 429 我做过对照：换个全新的合规会话 ID 还是 429，同一个 IP 下其他模型稳定 200，
出口 IP 也确实在美国。都不是原因，就是服务侧放号有限。

## 我踩过的坑

- 报 `403 RegionError`：出口地区不在服务范围。这里有个反直觉的地方，地区校验是先于形状校验跑的，
  所以这个报错根本说明不了你的配置有没有问题，先查代理再说。
- 报 `403 FreeTierError`：形状不对。要么扩展没加载，要么 `api` 被写到 model 层了，要么发了
  `x-opencode-request`。
- 报 `429 FreeUsageLimitError`：形状没问题，是那个模型限量提供、容量用尽了，换个模型或者过会儿再来。
- 排查的时候千万别加 `-ne`。`-ne` 等于 `--no-extensions`，扩展根本不加载，你配置再对也是失败，
  然后就会像我一样怀疑人生。测 Zen 相关的东西绝对不能带这个参数。
- 长会话里报 `Summarization failed: 403`：还是扩展没生效，同上去查。
- 改了文件没反应：扩展是启动时加载的，重启 Pi 或者 Percho。

验证的话跑这三条（还是那句话，别加 `-ne`）：

```bash
pi --list-models opencode-zen

pi -p --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: ZEN-OK"

# 这条是关键，走的是无工具请求那条路（也就是压缩时的形状），能回 NOTOOLS-OK 才说明扩展真的生效了
pi -p --no-tools --no-mcp --offline --no-session --model opencode-zen/cat-jam-free "Reply with exactly: NOTOOLS-OK"
```

## 关于风险

先说清楚，这不叫破解。免费层本来就不需要真 key，认证头写 `public` 就行，我没绕过任何认证。
但它的性质是伪装成官方客户端去用人家声明只给自家客户端用的额度，官方文档里也写了会监控滥用流量，
所以确实是在打条款擦边球。

实际后果就是限流，这个已经在发生了，再严重点可能封 IP。所以我自己的用法是拿它跑些零碎的
小任务，别挂自动化、别跑批量。真要稳定用，10 美元一个月的 OpenCode Go 才是正路，
Pi 在那边是官方认可的客户端。

---

## 短版（发群或者即刻用）

> 写了个 Pi 扩展，直连 OpenCode 免费层，不用中间代理进程也不用真 key。
>
> 免费层是按请求形状放行的，要求 tools 里必须有 `bash` 和 `read`、UA 得带 opencode 版本号、
> 会话 ID 还得符合特定的时间戳布局。Pi 正常聊天没问题，但压缩请求不带 tools，一压缩就 403，
> 扩展负责把形状补回去。
>
> 三个前提：大陆 IP 用不了必须挂代理；免费模型限量提供，大部分时候 429，稳定能用 3 个；
> 属于条款擦边球，风险自负。
>
> 仓库：<https://github.com/ZhiAo1120/pi-opencode-zen>
