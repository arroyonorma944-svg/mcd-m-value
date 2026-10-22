# 报名材料

## 已提交（2026-10-22）

**报名仓库**：`M-China/mcd-developer-innovation-challenge`（官方报名仓库，937+ 报名 Issue）

**Issue**：https://github.com/M-China/mcd-developer-innovation-challenge/issues/1046

> 注：早前误提交到 `M-China/mcd-mcp-server`（Issue #31）。该仓库是 MCP 接入指南文档库，不是报名入口。已在正确仓库补交 #1046。

## Issue 报名正文（实际提交版本）

官方要求：**正文必须单行，中间不能有任何换行**；项目地址**不能用 Markdown 链接语法**，直接贴裸 URL。

```
【参赛申请】项目名称：麦值 M-Value（麦当劳浓度检测器） 项目地址：https://github.com/arroyonorma944-svg/mcd-m-value 项目简介：读取用户的麦当劳历史订单（order-list）与官方营养表（list-nutrition-foods），用一个 0-100 的 M 值量化「麦门浓度」。五维加权评分：忠诚度 30%、依赖性 22%、专一度 20%、包容度 16%、探索度 12%（反向），六档等级判定，附钠摄入估算与行为洞察。所有分数由确定性公式计算，零随机数，相同订单必得相同结果，可复现可检验；纯前端单文件实现，订单数据不上传、不出浏览器。开发工具 WorkBuddy，开发对话存档见仓库 workbuddy.md。在线体验：https://arroyonorma944-svg.github.io/mcd-m-value/
```

Issue 标题：

```
【参赛申请】麦值 M-Value · 麦当劳浓度检测器
```

---

## 提交前检查清单

### 仓库文件（必须）

| # | 文件 | 状态 | 说明 |
|---|---|---|---|
| 1 | `README.md` | ✅ | 项目介绍、安装、使用示例、目标用户 |
| 2 | `CONTEST_DECLARATION.md` | ✅ | 官方原文，未改动一字 |
| 3 | `MCP_INTEGRATION.md` | ✅ | Server / Tool / 调用流程 / 业务价值 |
| 4 | 源代码 | ✅ | `src/mvalue.js`（评分引擎）、`index.html`（Demo） |
| 5 | `mcp-config.example.json` | ✅ | 仅环境变量占位符 |
| 6 | `workbuddy.md` | ✅ | WorkBuddy 开发对话记录（3000 积分必需） |

### 仓库设置

- [ ] 仓库设为 **Public**
- [ ] 仓库创建时间在 2025-12-25 至 2026-10-25 之间（本仓库 2026-10-18 创建，符合）
- [ ] 仓库名建议：`mcd-m-value`（带 mcd 前缀，便于人搜到）

### GitHub Pages（可选但强烈建议）

- [ ] Settings → Pages → Source 选 `main` 分支 `/root`
- [ ] 访问 `https://用户名.github.io/mcd-m-value/` 确认能打开
- [ ] 把 Pages 链接加进 README 顶部（这是 Star 转化率的关键）

### 安全

- [ ] 确认没有任何 Token 明文（已扫描通过）
- [ ] 确认没有真实订单号、traceId、accountId（已扫描通过）
- [ ] `real_orders.json` / `real_nutrition.json` 等测试数据**不要提交**（已在 .gitignore 中排除）

---

## 时间节点

| 节点 | 时间 | 剩余 |
|---|---|---|
| 报名与排名截止 | 2026-10-25 23:59 | 6 天 |
| 榜单数据截止 | 2026-10-26 00:00 | — |
| 奖品信息提交截止 | 2026-11-14 | — |

---

## 推广提示（决定 Star 数）

排名完全按 Star 数，代码质量不影响排名。最后 24 小时是 Star 涨幅高峰。

当前门槛（2026-10-19 12:00 榜单）：

| 名次 | Star |
|---:|---:|
| 第 1 名 | 615 |
| 第 50 名 | 31 |
| 第 100 名 | 15 |

**目标**：至少 20 Star 稳住 100 名内（拿周边 + 3000 积分）。冲击前 50 需要 35+。

可用渠道：即刻、掘金、V2EX、小红书、朋友圈、技术群、公众号。文案可直接用页面上的「生成分享文案」按钮产出。
