# MCP 接入说明

本文说明「麦值 M-Value」实际使用的麦当劳 MCP Server、Tool、调用流程与业务价值。

所有内容均来自真实调用，不含推测。

---

## 1. MCP Server

| 项 | 值 |
|---|---|
| Server 名称 | `mcd-mcp`（麦当劳中国官方 MCP Server） |
| 接入地址 | `https://mcp.mcd.cn` |
| 传输协议 | Streamable HTTP |
| 鉴权方式 | `Authorization: Bearer <MCP_TOKEN>` |
| Server 版本 | `1.0.0`（握手返回 `serverInfo`） |
| 协议版本 | `2024-11-05` |
| 官方文档 | https://github.com/M-China/mcd-mcp-server |
| Token 申请 | https://open.mcd.cn/mcp |

### 连接验证

初始化握手返回（实测）：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "capabilities": { "tools": {} },
    "protocolVersion": "2024-11-05",
    "serverInfo": { "name": "mcd-mcp", "version": "1.0.0" }
  }
}
```

`tools/list` 实测返回 **35 个 Tool**（官方文档列 30 个，实际多 5 个：`query-survey-coupon`、`query-promotions`、`query-party-city` 等）。

---

## 2. 使用的 Tool

本项目核心依赖 3 个 Tool，1 个增强 Tool。

### 2.1 `order-list` — 历史订单查询（核心数据源）

| 项 | 值 |
|---|---|
| 入参 | 无（`{"properties":{},"type":"object"}`） |
| 出参 | `data.list[]`：订单数组 |

出参字段（实测确认）：

| 字段 | 类型 | 说明 | 本项目用途 |
|---|---|---|---|
| `orderId` | string | 订单编码 | 去重 |
| `orderType` | string | 订单类型 | 探索度（渠道多样性） |
| `createTime` | string | 下单时间，格式 `YYYY-MM-DD HH:mm:ss` | 忠诚度 / 依赖性 |
| `storeCode` | string | 门店编码 | 门店统计 |
| `storeName` | string | 门店名称 | 门店统计、洞察文案 |
| `orderStatus` | string | 订单状态（如「订单已完成」「部分退款」） | 数据清洗参考 |
| `realTotalAmount` | string | 实际金额（注意是**字符串**，可能为 `"0"`） | 包容度 |
| `orderProductList[]` | array | 商品列表 | 专一度 / 探索度 |
| `orderProductList[].productName` | string | 商品名称 | 专一度 / 营养匹配 |
| `orderProductList[].quantity` | integer | 数量 | 份数统计 |
| `orderProductList[].comboItemList` | array | 套餐子项 | 预留（当前版本未展开） |

**实测样例**（真实返回，已脱敏）：

```json
{
  "orderId": "10301571900XXXXXXXXXXXXXXX055",
  "orderType": "1",
  "createTime": "2026-08-29 17:01:15",
  "storeCode": "1990190",
  "storeName": "麦当劳南通通州万达餐厅",
  "orderStatus": "订单已完成",
  "realTotalAmount": "3",
  "orderProductList": [
    { "productCode": "521797", "productName": "北美招牌牧场酱", "quantity": 1 }
  ]
}
```

> 注：`orderId` 中间位已脱敏。`storeName` 为公开门店名称，保留以便说明字段来源。

### 2.2 `list-nutrition-foods` — 餐品营养信息（钠摄入估算）

| 项 | 值 |
|---|---|
| 入参 | 无 |
| 出参 | `data`：一段表格文本，格式 `[160]{col1,col2,...}:\n 值1,值2,...` |
| 实测记录数 | **160 条** |

列结构（实测）：`productName, nutritionDescription, energyKj, energyKcal, protein, fat, carbohydrate, sodium, calcium`

实测样例：

```text
猪柳麦满分,null,1288,308,16,16,24,781,213
中薯条,null,1210,289,4,12,38,165,18
```

**注意**：`data` 不是标准 JSON，是 `[N]{列名}:\n数据行` 的自定义表格文本格式，需要先解析列头再逐行切分。这是本项目踩到的一个真实坑，`src/mvalue.js` 的 `estimateSodium` 只负责匹配，解析在上层完成。

### 2.3 `query-my-account` — 积分账户（辅助上下文）

| 项 | 值 |
|---|---|
| 入参 | 无 |
| 出参 | `availablePoint` / `accumulativePoint` / `expiredPoint` / `usedPoint` 等 |

实测样例：

```json
{
  "availablePoint": "151.6",
  "accumulativePoint": "458.3",
  "expiredPoint": "306.7",
  "usedPoint": "0",
  "currentMouthExpirePoint": "0"
}
```

**用途**：本项目的 M 值不依赖积分，但 `expiredPoint` 可以补充一句「你有多少积分过期了」的洞察，作为辅助信息。当前版本未启用，列在此处说明接口可用。

### 2.4 `now-time-info` — 服务器时间（时间基准）

| 项 | 值 |
|---|---|
| 入参 | 无 |
| 出参 | `timestamp` / `datetime` / `timezone` / `offset` |

**为什么需要**：M 值计算涉及「最近 24 个月」的窗口过滤和时间相关统计。如果直接用本地时区时间，跨时区或有系统时钟偏差时会出现窗口错位。用 MCP 返回的服务器时间作为基准，保证评分一致。

实测样例：

```json
{
  "datetime": "2026-10-19T13:11:36.986",
  "formatted": "2026-10-19 13:11:36",
  "timezone": "GMT+08:00",
  "offset": "+08:00"
}
```

---

## 3. 调用流程

### 3.1 完整链路

```text
用户: "算算我的 M 值"
  │
  ├─ [1] now-time-info
  │       └─> 拿到服务器时间作为时间基准
  │
  ├─ [2] order-list
  │       └─> 拿到 data.list[]（历史订单）
  │
  ├─ [3] 数据清洗（本地，不调 MCP）
  │       ├─ 解析 createTime "YYYY-MM-DD HH:mm:ss"
  │       ├─ 过滤：超出 24 个月窗口 / 时间非法 / 无商品明细
  │       ├─ realTotalAmount 字符串转数字（"0" -> 0，"-" -> 0）
  │       └─ 按时间倒序
  │
  ├─ [4] 数量校验
  │       └─> 订单 < 3 单 → 返回 insufficient，终止（不硬算分）
  │
  ├─ [5] 五维打分（本地纯函数）
  │       ├─ 忠诚度 ← 首末跨度 + 月均单量
  │       ├─ 依赖性 ← 夜宵/非饭点/工作日的订单占比
  │       ├─ 专一度 ← Top1 占比 + Top3 覆盖率
  │       ├─ 包容度 ← 自付单比例 + 自付单均
  │       └─ 探索度 ← 每单新品数 + 门店数 + 渠道数（反向）
  │
  ├─ [6] list-nutrition-foods（可选，用户提到营养/钠时才调用）
  │       └─> 160 条营养表 → 与订单商品名做最长包含匹配
  │            └─> 覆盖率 < 40% → 标记 unreliable，不输出结论
  │
  └─ [7] 汇总
          └─> M 值 / 等级 / 五维明细 / 洞察文案
```

### 3.2 为什么先调 `now-time-info`

这一步看起来可省，但实测发现是必要的：`order-list` 返回的 `createTime` 是**不带时区的字符串**，解析时如果依赖本机时钟，在系统时间不准的机器上会把「未来订单」判成异常、把「近期订单」判成超窗。用服务器时间锚定基准，可复现性才成立。

### 3.3 错误处理

| 场景 | 实测表现 | 本项目处理 |
|---|---|---|
| Token 无效 / 过期 | HTTP 401 | 提示用户重新申请 Token |
| 触发限流（>600 次/分） | HTTP 429 | 本项目单次分析只调 2–3 次，不会触发 |
| `order-list` 返回空列表 | `data.list` 为空数组 | 走 `insufficient` 分支 |
| 订单无 `orderProductList` | 字段缺失 | 该订单被过滤掉，不参与计算 |
| 营养表匹配不到商品 | 名称不一致 | 跳过该商品，计入 `unmatchedNames`，不估算 |

**本项目从不猜测缺失数据。** 匹配不上就是匹配不上，宁可少一个洞察，也不给一个编出来的数字。

---

## 4. 业务价值

### 4.1 对用户

| 价值 | 说明 |
|---|---|
| **自我认知** | 订单数据本来就在那里，但没有入口把它变成一句话结论 |
| **可分享** | 「我的 M 值是 82」比「我一共花了 1149 元」更适合发社交平台 |
| **无说教** | 不做健康建议、不推销套餐，只呈现事实 |

### 4.2 对麦当劳 MCP 生态

这个项目填的是**订单类 Tool 的空白**。

榜单上大量项目集中在 `available-coupons`、`auto-bind-coupons`、`list-nutrition-foods`、`campaign-calendar` 这几个「决策辅助」类 Tool。这些 Tool 的特点是：结果有唯一最优解，所有项目做法趋同。

`order-list` 不一样。它返回的是**历史行为数据**，可以做统计、做画像、做趋势、做对比，可挖掘的角度远多于「今天吃什么」。但在本项目之前，它在参赛作品里的使用极少。

本项目验证了一件事：**MCP 的订单类 Tool 足够支撑一个完整的数据分析型 Skill**，而不只是查询入口。

### 4.3 技术价值

| 点 | 说明 |
|---|---|
| 展示了 `order-list` 的完整字段用法 | 包括 `realTotalAmount` 是字符串、套餐被拆成多商品这两个真实坑 |
| 展示了 `list-nutrition-foods` 的非标准返回格式 | `[160]{cols}:\n rows` 需要自定义解析，官方文档没写 |
| 展示了「数据不足时说不知道」的设计 | `insufficient` 与 `unreliable` 两种降级状态 |
| 纯前端可复现 | 评分引擎零依赖、无随机数，任何人 clone 下来都能验证 |

---

## 5. 安全与合规

| 项 | 做法 |
|---|---|
| **Token 处理** | 不写入任何提交文件；`mcp-config.example.json` 只使用 `YOUR_MCP_TOKEN` 占位符 |
| **订单数据** | 不落盘、不上传。浏览器内计算，关闭页面即清空 |
| **README 中的样例** | 均为真实返回，已移除 `orderId` 完整值和 `traceId` |
| **个人信息** | 不采集手机号、地址、账号 ID；只使用订单本身的商品与金额 |
| **营养结论** | 覆盖率不足时明确标注「不代表完整摄入量」，不冒充医学建议 |

---

## 6. 复现方式

想自己验证以上所有调用：

```bash
# 1. 握手
curl -X POST "https://mcp.mcd.cn" \
  -H "Authorization: Bearer YOUR_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0.1"}}}'

# 2. 查工具列表
curl -X POST "https://mcp.mcd.cn" \
  -H "Authorization: Bearer YOUR_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 3. 查历史订单
curl -X POST "https://mcp.mcd.cn" \
  -H "Authorization: Bearer YOUR_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"order-list","arguments":{}}}'
```

或用 WorkBuddy 连接器方式（见 README 安装章节）。
