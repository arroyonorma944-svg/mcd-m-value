/**
 * mcd-m-value · 麦值引擎 (M-Value Engine)
 *
 * 输入：麦当劳 MCP `order-list` 返回的订单列表 + `list-nutrition-foods` 营养表
 * 输出：0-100 的 M 值、五维分项、等级、趣味洞察
 *
 * 设计原则：
 * 1. 纯函数，无副作用，可在浏览器(Node/前端)双端运行。
 * 2. 不依赖任何随机数——同样的订单必须得到同样的 M 值（可复现，便于选手截图对比）。
 * 3. 数据不足时（订单少于 MIN_ORDERS）明确返回 insufficient，而不是硬凑一个分数。
 */

'use strict';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 订单量低于此值时，任何分数都不可信，直接判「数据不足」 */
const MIN_ORDERS = 3;

/** 统计窗口：只分析最近 N 个月内的订单 */
const WINDOW_MONTHS = 24;

/** 五维权重，合计 = 1.0 */
const WEIGHTS = {
  loyalty: 0.30,   // 忠诚度
  dependence: 0.22, // 依赖性
  devotion: 0.20,   // 专一度
  forgiveness: 0.16, // 包容度
  exploration: 0.12, // 探索度（反向）
};

/** M 值等级表，从高到低匹配 */
const TIERS = [
  { min: 90, key: 'saint',   name: '麦门圣徒',   tag: 'M 值天花板，汉堡因你而存在', emoji: '🍔' },
  { min: 75, key: 'devotee', name: '麦门虔诚者', tag: '你的手机桌面应该有金拱门', emoji: '🙏' },
  { min: 60, key: 'regular', name: '资深麦友',   tag: '熟悉的柜台，熟悉的味道', emoji: '😌' },
  { min: 40, key: 'casual',  name: '路过型食客', tag: '有缘才见，无缘不念', emoji: '🚶' },
  { min: 20, key: 'tourist', name: '尝鲜游客',   tag: '你只是刚好饿了', emoji: '🧭' },
  { min: 0,  key: 'alien',   name: '麦门陌生人', tag: '这张订单表基本都是别人的故事', emoji: '👽' },
];

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 解析 "2026-08-29 17:01:15" -> Date（ISO 规范要求月日补零，此处做健壮处理） */
function parseOrderTime(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (m) {
    const [, y, mo, d, h, mi, se] = m.map(Number);
    return new Date(y, mo - 1, d, h, mi, se);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** 金额字段是字符串，可能为空 / "-" / "0" */
function parseAmount(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** 线性映射并裁剪到 [0,1] */
function clamp01(x) {
  if (!isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 分段线性：把 x 从 [lo,hi] 映射到 [0,1] */
function ramp(x, lo, hi) {
  if (hi === lo) return x >= hi ? 1 : 0;
  return clamp01((x - lo) / (hi - lo));
}

/** 四舍五入到 1 位小数 */
function r1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * 香农熵归一化：给定频次数组，返回 0(完全集中) ~ 1(完全均匀)
 * 用自然对数，n<=1 时返回 0
 */
function normalizedEntropy(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0 || counts.length <= 1) return 0;
  let h = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / total;
      h -= p * Math.log(p);
    }
  }
  const max = Math.log(counts.length);
  return max > 0 ? clamp01(h / max) : 0;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 计算 M 值
 * @param {Array} rawOrders - order-list 返回的 data.list 数组
 * @param {Object} [opts]
 * @param {Date}   [opts.now]        - 参考"现在"的时间，默认系统时间
 * @param {Array}  [opts.nutrition]  - list-nutrition-foods 解析后的营养表（可选）
 * @returns {Object} 完整报告对象
 */
function computeMValue(rawOrders, opts) {
  opts = opts || {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const orders = normalizeOrders(rawOrders, now);

  if (orders.length < MIN_ORDERS) {
    return {
      ok: false,
      reason: 'insufficient',
      orderCount: orders.length,
      minRequired: MIN_ORDERS,
      message: `你的订单太少（${orders.length} 笔），M 值检测需要至少 ${MIN_ORDERS} 笔有效订单。再去吃几次，回来重新测。`,
    };
  }

  const dims = {
    loyalty: scoreLoyalty(orders, now),
    dependence: scoreDependence(orders),
    devotion: scoreDevotion(orders),
    forgiveness: scoreForgiveness(orders),
    exploration: scoreExploration(orders),
  };

  // 综合分：五个维度按权重加权，exploration 已转为"探索度低=分高"
  const total =
    dims.loyalty.value * WEIGHTS.loyalty +
    dims.dependence.value * WEIGHTS.dependence +
    dims.devotion.value * WEIGHTS.devotion +
    dims.forgiveness.value * WEIGHTS.forgiveness +
    dims.exploration.value * WEIGHTS.exploration;

  const mValue = Math.round(clamp01(total) * 100);
  const tier = pickTier(mValue);

  const stats = buildStats(orders, now);
  const sodium = estimateSodium(orders, opts.nutrition);

  return {
    ok: true,
    mValue: mValue,
    tier: tier,
    dimensions: dims,
    weights: WEIGHTS,
    stats: stats,
    sodium: sodium,
    insights: buildInsights(orders, stats, dims, sodium, now),
    orderCount: orders.length,
    generatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 数据清洗
// ---------------------------------------------------------------------------

/**
 * 把 MCP 原始订单整理成统一结构，并按窗口期过滤、按时间倒序。
 */
function normalizeOrders(rawOrders, now) {
  if (!Array.isArray(rawOrders)) return [];
  const cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - WINDOW_MONTHS);

  const out = [];
  for (const o of rawOrders) {
    const t = parseOrderTime(o && o.createTime);
    if (!t || isNaN(t.getTime())) continue;
    if (t < cutoff || t > now) continue;

    const items = [];
    const plist = (o.orderProductList && Array.isArray(o.orderProductList)) ? o.orderProductList : [];
    for (const p of plist) {
      const name = (p && p.productName ? String(p.productName) : '').trim();
      if (!name) continue;
      const qty = parseInt(p.quantity, 10);
      items.push({
        code: p.productCode || '',
        name: name,
        qty: isNaN(qty) || qty <= 0 ? 1 : qty,
        // 子项（套餐内替换项）扁平化，避免重复计数
        children: Array.isArray(p.comboItemList) ? p.comboItemList.map(c => c && c.itemName).filter(Boolean) : [],
      });
    }
    if (items.length === 0) continue;

    out.push({
      id: o.orderId || '',
      time: t,
      hour: t.getHours(),
      weekday: t.getDay(), // 0=周日
      amount: parseAmount(o.realTotalAmount),
      store: (o.storeName || '').trim(),
      storeCode: (o.storeCode || '').trim(),
      status: (o.orderStatus || '').trim(),
      channel: String(o.orderType || ''),
      items: items,
    });
  }

  out.sort((a, b) => b.time - a.time);
  return out;
}

// ---------------------------------------------------------------------------
// 五个维度
// ---------------------------------------------------------------------------

/**
 * 忠诚度 —— 你来了多久、来了多少次
 * 组合两个信号：
 *   1) 消费跨度（首次到最后一次之间的月数）
 *   2) 月均单量
 * 某一项拉满就能拿高分：老顾客 + 低频，或新顾客 + 高频，都算忠诚。
 *
 * 标定依据（用真实 MCP 订单与三套示例画像反复校准）：
 * - 跨度阈值从 18 月降到 12 月：一年以上的持续消费已经算重度
 * - 月均阈值从 2 单降到 1.5 单：月均 1.5 单 ≈ 每月 1-2 次，已是高频
 */
function scoreLoyalty(orders, now) {
  const times = orders.map(o => o.time.getTime());
  const spanDays = (Math.max(...times) - Math.min(...times)) / 86400000;
  const spanMonths = spanDays / 30.44;

  // 跨度：0 月 -> 0 分；12 月 -> 1 分
  const spanScore = ramp(spanMonths, 0, 12);

  // 月均单量：至少按 1 个月算，避免"1 天 3 单"算出爆炸值
  const months = Math.max(spanMonths, 1);
  const perMonth = orders.length / months;
  // 每月 0.2 单 -> 0 分；每月 1.5 单 -> 1 分
  const freqScore = ramp(perMonth, 0.2, 1.5);

  const value = 0.55 * spanScore + 0.45 * freqScore;

  return {
    key: 'loyalty',
    label: '忠诚度',
    value: clamp01(value),
    detail: `跨度 ${r1(spanMonths)} 个月 / 共 ${orders.length} 单 / 月均 ${r1(perMonth)} 单`,
  };
}

/**
 * 依赖性 —— 你在什么时间点会想吃麦当劳
 * 依赖的典型特征：深夜点单、工作日常点、饭点不规律。
 * 这里衡量"点单时段的非常规程度" + "出现频率"。
 */
function scoreDependence(orders) {
  const n = orders.length;
  let night = 0;      // 22:00 - 05:00
  let workday = 0;    // 周一至周五
  let oddHour = 0;    // 非正餐时段（不在 11-13, 17-20）

  for (const o of orders) {
    if (o.hour >= 22 || o.hour < 5) night++;
    if (o.weekday >= 1 && o.weekday <= 5) workday++;
    const isMeal = (o.hour >= 11 && o.hour <= 13) || (o.hour >= 17 && o.hour <= 20);
    if (!isMeal) oddHour++;
  }

  const nightRatio = night / n;
  const workdayRatio = workday / n;
  const oddRatio = oddHour / n;

  // 非常规程度：夜宵 + 工作日常点 + 非饭点
  const irregularity = 0.45 * nightRatio + 0.30 * oddRatio + 0.25 * workdayRatio;

  // 强度：单量本身要够多，否则"不规则"没有说服力（8 单即接近满强度）
  const intensity = ramp(n, 2, 8);

  const value = 0.72 * irregularity + 0.28 * intensity;

  return {
    key: 'dependence',
    label: '依赖性',
    value: clamp01(value),
    detail: `夜宵 ${night} 次 / 非饭点 ${oddHour} 次 / 工作日 ${workday} 次`,
  };
}

/**
 * 专一度 —— 你是不是只点那几样
 *
 * 不能用归一化熵：熵只衡量"分布是否均匀"，与"到底有几种商品"无关。
 * 一个只点 4 种商品但每样都点、与一个点了 50 种商品且均匀分布的人，
 * 归一化熵都可能接近 1，被判成同样不专一。这显然不对。
 *
 * 改用两个绝对指标：
 *   1) Top1 单品占比：最常点的那个占全部份数的比例（0.5 以上算很专一）
 *   2) Top3 覆盖率：前三个单品占总份数的比例
 * 两者组合，且以 Top1 为主，避免"只点两样但两样各半"被误判。
 */
function scoreDevotion(orders) {
  const counter = new Map();
  for (const o of orders) {
    for (const it of o.items) {
      counter.set(it.name, (counter.get(it.name) || 0) + it.qty);
    }
  }
  const entries = Array.from(counter.entries()).sort((a, b) => b[1] - a[1]);
  const totalItems = entries.reduce((a, [, c]) => a + c, 0);

  const top = entries.slice(0, 3).map(([name, count]) => ({ name, count }));
  const top1Share = totalItems > 0 && entries.length ? entries[0][1] / totalItems : 0;
  const top3Count = entries.slice(0, 3).reduce((a, [, c]) => a + c, 0);
  const top3Share = totalItems > 0 ? top3Count / totalItems : 0;

  // Top1 占 15% -> 0 分；占 55% -> 1 分
  const s1 = ramp(top1Share, 0.15, 0.55);
  // Top3 占 40% -> 0 分；占 90% -> 1 分
  const s3 = ramp(top3Share, 0.40, 0.90);

  const value = clamp01(0.60 * s1 + 0.40 * s3);

  return {
    key: 'devotion',
    label: '专一度',
    value: value,
    detail: `共 ${entries.length} 种商品，最高频单品占 ${Math.round(top1Share * 100)}%，前三占 ${Math.round(top3Share * 100)}%`,
    topItems: top,
  };
}

/**
 * 包容度（原"支付诚度"）—— 你是否愿意为麦当劳掏真金白银
 * 免费券/0 元单占比越高，说明你吃得多但付得少；自付比例越高，越"诚"。
 * 同时看单均金额：愿意点贵套餐的人，包容度更高。
 */
function scoreForgiveness(orders) {
  const n = orders.length;
  let freeOrders = 0;
  let paidTotal = 0;
  let paidCount = 0;

  for (const o of orders) {
    if (o.amount <= 0.01) freeOrders++;
    else {
      paidTotal += o.amount;
      paidCount++;
    }
  }

  const paidRatio = n > 0 ? paidCount / n : 0;
  const avgPaid = paidCount > 0 ? paidTotal / paidCount : 0;

  // 自付比例 0% -> 0 分；80% -> 1 分
  const ratioScore = ramp(paidRatio, 0, 0.8);
  // 单均 5 元 -> 0 分；45 元 -> 1 分
  const amountScore = ramp(avgPaid, 5, 45);

  const value = 0.65 * ratioScore + 0.35 * amountScore;

  return {
    key: 'forgiveness',
    label: '包容度',
    value: clamp01(value),
    detail: `付费单 ${paidCount}/${n} 单 / 自付单均 ${r1(avgPaid)} 元`,
    paidTotal: r1(paidTotal),
  };
}

/**
 * 探索度 —— 反向维度：你越爱尝鲜，M 值越低
 *
 * 注意：不能用商品频次的归一化熵直接当"多样度"，因为熵在样本量小时会被
 * 系统性压低（6 单 7 种商品会算出"很集中"，但它其实很分散）。
 *
 * 这里用四个不依赖样本量的绝对指标：
 *   1) 商品种类绝对数（最直接的尝鲜信号：一共试过多少样）
 *   2) 商品种类 / 订单数（每单平均带出多少新东西）
 *   3) 门店数量（跨店越多越"逛"）
 *   4) 下单渠道种类
 * 然后用数量系数折减：订单太少时，探索行为本身不足以说明问题。
 */
function scoreExploration(orders) {
  const n = orders.length;
  const counter = new Map();
  for (const o of orders) {
    for (const it of o.items) counter.set(it.name, (counter.get(it.name) || 0) + it.qty);
  }
  const itemCount = counter.size;

  // 1) 试过多少种商品：3 种 -> 0 分；12 种 -> 1 分
  const catalogVariety = ramp(itemCount, 3, 12);

  // 2) 新鲜度：订单里有多少是"第一次点这个商品"
  //    这里不能用"商品种类/订单数"，因为每单只买 1 样的话该比值恒为 1，
  //    哪怕每次买的都是全新商品，也会被判成不尝鲜。
  //    countFirstSeen 返回的是"新品条目占全部条目"的比例，直接把 0~1 映射到 0.2~1。
  const noveltyRatio = countFirstSeen(orders);
  const novelty = ramp(noveltyRatio, 0.2, 1.0);

  const stores = new Set(orders.map(o => o.store).filter(Boolean));
  const storeVariety = ramp(stores.size, 1, 4); // 1 家 -> 0；4 家 -> 1

  const channels = new Set(orders.map(o => o.channel).filter(Boolean));
  const channelVariety = ramp(channels.size, 1, 3);

  // 权重：新鲜度与门店数最能反映"逛"的行为，给更高权重。
  const exploreRaw =
    0.30 * catalogVariety +
    0.34 * novelty +
    0.28 * storeVariety +
    0.08 * channelVariety;

  // 数量系数：订单少于 6 单时，探索度按比例打折，避免"3 单 3 家店"直接满分
  const confidence = ramp(n, 2, 6);
  const explore = clamp01(exploreRaw * (0.55 + 0.45 * confidence));

  const value = clamp01(1 - explore); // 反向：探索越多，M 值越低

  return {
    key: 'exploration',
    label: '探索度',
    value: value,
    reverse: true,
    exploreScore: r1(explore * 100),
    detail: `${itemCount} 种商品 / ${stores.size} 家门店 / ${channels.size} 种下单渠道`,
  };
}

// ---------------------------------------------------------------------------
// 统计与洞察
// ---------------------------------------------------------------------------

function buildStats(orders, now) {
  const n = orders.length;
  const times = orders.map(o => o.time.getTime());
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  const spanDays = Math.round((Math.max(...times) - Math.min(...times)) / 86400000);

  // 时段分布（0-23 小时）
  const hourHist = new Array(24).fill(0);
  for (const o of orders) hourHist[o.hour]++;

  // 门店排行
  const storeMap = new Map();
  for (const o of orders) {
    if (!o.store) continue;
    storeMap.set(o.store, (storeMap.get(o.store) || 0) + 1);
  }
  const topStores = Array.from(storeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // 商品排行
  const itemMap = new Map();
  for (const o of orders) {
    for (const it of o.items) itemMap.set(it.name, (itemMap.get(it.name) || 0) + it.qty);
  }
  const topItems = Array.from(itemMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // 间隔分析：相邻两次下单的天数
  const gaps = [];
  const asc = orders.slice().sort((a, b) => a.time - b.time);
  for (let i = 1; i < asc.length; i++) {
    gaps.push((asc[i].time - asc[i - 1].time) / 86400000);
  }
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

  const paidAmounts = orders.filter(o => o.amount > 0).map(o => o.amount);
  const totalSpent = paidAmounts.reduce((a, b) => a + b, 0);

  return {
    orderCount: n,
    firstOrder: first.toISOString().slice(0, 10),
    lastOrder: last.toISOString().slice(0, 10),
    spanDays: spanDays,
    hourHist: hourHist,
    topStores: topStores,
    topItems: topItems,
    avgGapDays: r1(avgGap),
    minGapDays: gaps.length ? r1(Math.min(...gaps)) : 0,
    totalSpent: r1(totalSpent),
    avgSpent: paidAmounts.length ? r1(totalSpent / paidAmounts.length) : 0,
    freeOrderCount: orders.filter(o => o.amount <= 0.01).length,
    distinctItems: itemMap.size,
    distinctStores: new Set(orders.map(o => o.store).filter(Boolean)).size,
  };
}

/**
 * 钠摄入估算：把订单里的商品名模糊匹配到营养表，累加钠含量。
 *
 * 设计约束（都是实测踩出来的）：
 * - 营养表以主餐为主，甜品/单点酱料匹配率低，所以必须输出 coverage，
 *   覆盖率过低（< 40%）时标记为 unreliable，不参与洞察。
 * - 只有"大额或主餐"才算有意义；纯 0 元的券单会污染统计，这里仍然计入
 *   （因为确实吃了），但会在洞察里说明覆盖范围。
 */
function estimateSodium(orders, nutrition) {
  if (!Array.isArray(nutrition) || nutrition.length === 0) {
    return { ok: false, reliable: false, reason: 'no-nutrition-data', totalSodiumMg: null, coverage: 0 };
  }

  const table = nutrition
    .map(x => ({
      name: String(x.productName || '').trim(),
      sodium: parseFloat(x.sodium),
      kcal: parseFloat(x.energyKcal),
    }))
    .filter(x => x.name && isFinite(x.sodium))
    .sort((a, b) => b.name.length - a.name.length);

  let totalSodium = 0;
  let totalKcal = 0;
  let matchedItems = 0;
  let matchedOrders = 0;
  const matchedNames = [];
  const unmatchedNames = [];

  for (const o of orders) {
    let orderMatched = false;
    for (const it of o.items) {
      const hit = matchNutrition(it.name, table);
      if (hit) {
        totalSodium += hit.sodium * it.qty;
        totalKcal += (isFinite(hit.kcal) ? hit.kcal : 0) * it.qty;
        matchedItems++;
        matchedNames.push(hit.name);
        orderMatched = true;
      } else {
        unmatchedNames.push(it.name);
      }
    }
    if (orderMatched) matchedOrders++;
  }

  const coverage = orders.length ? Math.round((matchedOrders / orders.length) * 100) : 0;

  return {
    ok: matchedItems > 0,
    // 覆盖率低于 40% 时，估算值代表性不足，不用于生成洞察
    reliable: matchedItems > 0 && coverage >= 40,
    totalSodiumMg: Math.round(totalSodium),
    totalKcal: Math.round(totalKcal),
    matchedItems: matchedItems,
    matchedOrders: matchedOrders,
    coverage: coverage,
    matchedNames: matchedNames.slice(0, 10),
    unmatchedNames: unmatchedNames.slice(0, 10),
  };
}

/** 商品名模糊匹配：包含关系，取最长命中 */
function matchNutrition(name, table) {
  const n = String(name || '').replace(/\s+/g, '');
  if (!n) return null;
  for (const row of table) {
    const t = row.name.replace(/\s+/g, '');
    if (t && (n.includes(t) || t.includes(n))) return row;
  }
  return null;
}

function pickTier(m) {
  for (const t of TIERS) {
    if (m >= t.min) return t;
  }
  return TIERS[TIERS.length - 1];
}

/** 统计某个商品出现在多少笔订单里（不是份数） */
function countOrderPresence(orders, name) {
  let n = 0;
  for (const o of orders) {
    if (o.items.some(it => it.name === name)) n++;
  }
  return n;
}

/**
 * 计算"新品尝鲜率"：按时间正序推进，统计每笔订单中有多少商品是此前从未点过的。
 *
 * 返回 (首次出现的商品条目数) / (全部商品条目数)。
 * - 每次都在试新东西 -> 接近 1
 * - 反复点同样的几样 -> 快速收敛到接近 0
 *
 * 注意：第一笔订单的所有商品必然都是新的，所以订单越少，这个值天然越高，
 * 由外层的 confidence 数量系数负责折减。
 */
function countFirstSeen(orders) {
  const asc = orders.slice().sort((a, b) => a.time - b.time);
  const seen = new Set();
  let totalEntries = 0;
  let newEntries = 0;

  for (const o of asc) {
    for (const it of o.items) {
      totalEntries++;
      if (!seen.has(it.name)) {
        newEntries++;
        seen.add(it.name);
      }
    }
  }

  return totalEntries > 0 ? newEntries / totalEntries : 0;
}

/**
 * 生成 3-5 条洞察文案。按"数据强度"排序，不硬凑。
 */
function buildInsights(orders, stats, dims, sodium, now) {
  const out = [];

  // 1. 夜宵洞察
  let night = 0;
  let latestHour = -1;
  for (const o of orders) {
    if (o.hour >= 22 || o.hour < 5) night++;
    if (o.hour > latestHour) latestHour = o.hour;
  }
  if (night > 0) {
    out.push({
      icon: '🌙',
      title: `你有 ${night} 次在深夜点单`,
      text: `最晚一次是 ${latestHour} 点。那个时间想起麦当劳的人，通常不是饿了，是心里空了一块。`,
      weight: 90 + night,
    });
  }

  // 2. 复购节奏 —— 按最小间隔分三种情况，不能把两种矛盾的判断拼在一起
  if (stats.avgGapDays > 0) {
    let text;
    if (stats.minGapDays < 1) {
      text = `但最密的一次是连续下单（间隔不到 1 天）。你已经不是在点餐，是在下指令。`;
    } else if (stats.minGapDays < 7) {
      text = `最密的一次只隔了 ${stats.minGapDays} 天。这个节奏，比大多数人还稳定。`;
    } else {
      text = `最快的一次也隔了 ${stats.minGapDays} 天。间隔够长，说明每次都是真的想吃。`;
    }
    out.push({
      icon: '⏱️',
      title: `平均每 ${stats.avgGapDays} 天点一次`,
      text: text,
      weight: 70,
    });
  }

  // 3. 常点单品 —— 按"订单出现次数"计，而不是按份数
  // 因为套餐拆成了多个商品，按份数会把"巨无霸 26 份"算成重点，容易误导。
  if (stats.topItems.length) {
    const top = stats.topItems[0];
    const times = countOrderPresence(orders, top.name);
    const second = stats.topItems[1];
    let text = `${stats.orderCount} 单里有 ${times} 单点了它。`;
    if (second) {
      const t2 = countOrderPresence(orders, second.name);
      text += `第二名是「${second.name}」，出现 ${t2} 单。`;
    }
    text += '换菜单的时候，你大概率还是在等它。';
    out.push({
      icon: '🍟',
      title: `你的本命是「${top.name}」`,
      text: text,
      weight: 80,
    });
  }

  // 4. 门店
  if (stats.topStores.length) {
    const s = stats.topStores[0];
    out.push({
      icon: '🏪',
      title: `你最常去「${s.name}」`,
      text: `${s.count} 单。${stats.distinctStores > 1 ? `前后共光顾 ${stats.distinctStores} 家店，但还是这家最熟。` : '而且只认这一家。'}`,
      weight: 60,
    });
  }

  // 5. 付费
  if (stats.freeOrderCount > 0) {
    out.push({
      icon: '🎫',
      title: `${stats.freeOrderCount} 单是 0 元成交`,
      text: `累计自付 ${stats.totalSpent} 元，付费单均 ${stats.avgSpent} 元。券是本事，但账单不会骗人。`,
      weight: 65,
    });
  }

  // 6. 钠 —— 只在覆盖率足够时输出，否则宁可不说
  if (sodium && sodium.ok && sodium.reliable && sodium.totalSodiumMg > 0) {
    const grams = (sodium.totalSodiumMg / 1000).toFixed(1);
    const whoPerDay = (sodium.totalSodiumMg / 2000).toFixed(1);
    out.push({
      icon: '🧂',
      title: `这些订单累计约 ${grams} 克钠`,
      text: `相当于 ${whoPerDay} 天的世卫组织建议摄入上限（2 克/天）。营养数据覆盖了 ${sodium.coverage}% 的订单，未匹配到的餐品没有计入。`,
      weight: 85,
    });
  }

  // 7. 跨度
  out.push({
    icon: '📅',
    title: `从 ${stats.firstOrder} 到 ${stats.lastOrder}`,
    text: `${stats.spanDays} 天，${stats.orderCount} 单。${dims.loyalty.value > 0.7 ? '这段时间里，金拱门一直在你的生活半径内。' : '断断续续，但每次都回来了。'}`,
    weight: 40,
  });

  out.sort((a, b) => b.weight - a.weight);
  return out.slice(0, 5).map(({ weight, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// 导出（同时兼容 CommonJS / 浏览器全局 / ES Module 引用）
// ---------------------------------------------------------------------------

const MValue = {
  computeMValue,
  normalizeOrders,
  estimateSodium,
  pickTier,
  WEIGHTS,
  TIERS,
  MIN_ORDERS,
  WINDOW_MONTHS,
  _internal: { parseOrderTime, parseAmount, normalizedEntropy, ramp, r1 },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MValue;
}
if (typeof window !== 'undefined') {
  window.MValue = MValue;
}
