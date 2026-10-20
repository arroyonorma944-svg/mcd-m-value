/**
 * mcd-m-value 边界测试
 *
 * 运行：node test.js
 *
 * 测试原则：只测行为，不测实现细节。每个用例都对应一个"如果坏了会怎样"的真实担心。
 */

'use strict';

const M = require('./src/mvalue.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(name + (extra ? '  →  ' + extra : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

function near(name, actual, expected, tol) {
  tol = tol == null ? 0.01 : tol;
  ok(name, Math.abs(actual - expected) <= tol, `期望 ≈${expected}，实际 ${actual}`);
}

// ---------------------------------------------------------------------------
// 测试数据构造
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-19T14:00:00+08:00');

/** 构造订单 */
function order(dateStr, hour, items, amount, store, type) {
  return {
    orderId: 'T' + dateStr + hour,
    orderType: type || '1',
    createTime: dateStr + ' ' + String(hour).padStart(2, '0') + ':30:00',
    storeCode: '1990' + (store || 0),
    storeName: '测试门店' + (store || 0),
    orderStatus: '订单已完成',
    realTotalAmount: String(amount == null ? 30 : amount),
    orderProductList: items.map(([name, qty]) => ({
      productCode: 'P1',
      productName: name,
      quantity: qty || 1,
      comboItemList: [],
    })),
  };
}

/** 生成 N 条规律订单 */
// menu 是「商品列表的列表」：[[['巨无霸',1]], [['中薯条',1]]]
function series(count, opts) {
  opts = opts || {};
  const out = [];
  const start = new Date('2026-01-01T12:00:00+08:00');
  const gapDays = opts.gapDays || 7;
  const menu = opts.menu || [[['巨无霸', 1]]];
  const hours = opts.hours || [12];
  const storeCount = opts.stores || 1;
  const amounts = opts.amounts || [35];
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getTime() + i * gapDays * 86400000);
    const ds = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    out.push(order(
      ds,
      hours[i % hours.length],
      menu[i % menu.length],
      amounts[i % amounts.length],
      i % storeCount,
      '1'
    ));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. 边界：数据不足
// ---------------------------------------------------------------------------

{
  const r = M.computeMValue([], { now: NOW });
  eq('空订单 -> ok=false', r.ok, false);
  eq('空订单 -> reason=insufficient', r.reason, 'insufficient');
  eq('空订单 -> 不返回 mValue', r.mValue, undefined);
}

{
  const r = M.computeMValue(series(2), { now: NOW });
  eq('2 单（低于 MIN_ORDERS=3）-> insufficient', r.ok, false);
}

{
  const r = M.computeMValue(series(3), { now: NOW });
  eq('3 单（正好达阈值）-> 正常计算', r.ok, true);
}

{
  const r = M.computeMValue(null, { now: NOW });
  eq('null 输入不崩溃', r.ok, false);
}

{
  const r = M.computeMValue(undefined, { now: NOW });
  eq('undefined 输入不崩溃', r.ok, false);
}

// ---------------------------------------------------------------------------
// 2. 边界：脏数据
// ---------------------------------------------------------------------------

{
  const bad = [
    { createTime: 'not-a-date', orderProductList: [{ productName: '巨无霸', quantity: 1 }] },
    { createTime: '2026-01-01 12:00:00', orderProductList: [] },
    { createTime: '2026-01-02 12:00:00', orderProductList: null },
    { createTime: '2026-01-03 12:00:00', orderProductList: [{ productName: '', quantity: 1 }] },
    order('2026-01-04', 12, [['巨无霸', 1]]),
    order('2026-01-05', 12, [['巨无霸', 1]]),
    order('2026-01-06', 12, [['巨无霸', 1]]),
  ];
  const r = M.computeMValue(bad, { now: NOW });
  eq('脏数据被过滤，剩 3 条有效', r.orderCount, 3);
  eq('脏数据场景仍能计算', r.ok, true);
}

{
  // 未来订单应被剔除
  const list = series(3);
  list.push(order('2027-01-01', 12, [['巨无霸', 1]]));
  const r = M.computeMValue(list, { now: NOW });
  eq('未来订单被剔除', r.orderCount, 3);
}

{
  // 超出 24 个月窗口应被剔除
  const list = series(3);
  list.push(order('2023-01-01', 12, [['巨无霸', 1]]));
  const r = M.computeMValue(list, { now: NOW });
  eq('超窗订单被剔除', r.orderCount, 3);
}

{
  // 金额字段的脏值
  const list = series(3);
  list[0].realTotalAmount = '-';
  list[1].realTotalAmount = null;
  list[2].realTotalAmount = 'abc';
  const r = M.computeMValue(list, { now: NOW });
  eq('金额脏值不导致崩溃', r.ok, true);
  eq('金额脏值视为 0', r.stats.totalSpent, 0);
}

// ---------------------------------------------------------------------------
// 3. 核心：专一度修复验证（这是最关键的一个 bug 修复）
// ---------------------------------------------------------------------------

{
  // 只点 3 种商品、反复点 -> 应该专一度高
  const list = series(20, { menu: [[['巨无霸', 1]], [['板烧鸡腿堡', 1]], [['双层吉士堡', 1]]] });
  const r = M.computeMValue(list, { now: NOW });
  const dev = r.dimensions.devotion.value;
  ok('专一型用户专一度 > 0.4', dev > 0.4, `实际 ${dev.toFixed(3)}`);
}

{
  // 12 种商品各点一次 -> 专一度应接近 0
  const names = ['巨无霸', '板烧鸡腿堡', '双层吉士堡', '麦辣鸡腿堡', '麦香鱼', '麦乐鸡5块',
    '中薯条', '圆筒冰淇淋', '麦旋风', '新地', '香芋派', '苹果派'];
  const list = series(12, { menu: names.map(n => [[n, 1]]) });
  const r = M.computeMValue(list, { now: NOW });
  const dev = r.dimensions.devotion.value;
  ok('分散型用户专一度 < 0.15', dev < 0.15, `实际 ${dev.toFixed(3)}`);
}

{
  // 专一型必须显著高于分散型
  const narrow = M.computeMValue(series(20, { menu: [[['巨无霸', 1], ['中薯条', 1]], [['板烧鸡腿堡', 1], ['中薯条', 1]]] }), { now: NOW });
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const wide = M.computeMValue(series(12, { menu: names.map(n => [[n, 1]]) }), { now: NOW });
  ok('专一度区分度 > 0.5',
    narrow.dimensions.devotion.value - wide.dimensions.devotion.value > 0.5,
    `narrow=${narrow.dimensions.devotion.value.toFixed(3)} wide=${wide.dimensions.devotion.value.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// 4. 核心：探索度修复验证
// ---------------------------------------------------------------------------

{
  // 单一门店 单一商品 -> 探索度（反向）应高
  const single = M.computeMValue(series(10, { menu: [[['巨无霸', 1]]], stores: 1 }), { now: NOW });
  // 多门店 多商品 -> 探索度（反向）应低
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const diverse = M.computeMValue(series(12, { menu: names.map(n => [[n, 1]]), stores: 5 }), { now: NOW });

  ok('单一型探索度（反向）高', single.dimensions.exploration.value > 0.7,
    `实际 ${single.dimensions.exploration.value.toFixed(3)}`);
  ok('多样型探索度（反向）低', diverse.dimensions.exploration.value < 0.4,
    `实际 ${diverse.dimensions.exploration.value.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// 5. 确定性：同样输入必须同样输出
// ---------------------------------------------------------------------------

{
  const a = M.computeMValue(series(8), { now: NOW });
  const b = M.computeMValue(series(8), { now: NOW });
  eq('确定性：两次计算结果一致', a.mValue, b.mValue);
  eq('确定性：洞察条数一致', a.insights.length, b.insights.length);
}

{
  // 输入顺序不应影响结果（内部会排序）
  const list = series(8);
  const shuffled = list.slice().reverse();
  const a = M.computeMValue(list, { now: NOW });
  const b = M.computeMValue(shuffled, { now: NOW });
  eq('顺序无关：倒序输入结果一致', a.mValue, b.mValue);
}

// ---------------------------------------------------------------------------
// 6. 值域
// ---------------------------------------------------------------------------

{
  const cases = [
    series(3),
    series(30, { gapDays: 3 }),
    series(50, { gapDays: 1, hours: [23, 0, 1, 2], amounts: [60] }),
    series(5, { amounts: [0] }),
  ];
  cases.forEach((list, i) => {
    const r = M.computeMValue(list, { now: NOW });
    ok(`值域用例 ${i}: mValue 在 0-100`, r.mValue >= 0 && r.mValue <= 100, `实际 ${r.mValue}`);
    ok(`值域用例 ${i}: mValue 是整数`, Number.isInteger(r.mValue), `实际 ${r.mValue}`);
    Object.keys(r.dimensions).forEach(k => {
      const v = r.dimensions[k].value;
      ok(`值域用例 ${i}: ${k} 在 0-1`, v >= 0 && v <= 1, `实际 ${v}`);
    });
  });
}

{
  // 全 0 元订单 -> 包容度应该很低
  const r = M.computeMValue(series(10, { amounts: [0] }), { now: NOW });
  ok('全免费订单包容度低', r.dimensions.forgiveness.value < 0.2,
    `实际 ${r.dimensions.forgiveness.value.toFixed(3)}`);
}

{
  // 深夜订单 -> 依赖性应该高
  const night = M.computeMValue(series(10, { hours: [23, 0, 1, 2, 3] }), { now: NOW });
  const noon = M.computeMValue(series(10, { hours: [12, 13] }), { now: NOW });
  ok('深夜党依赖性高于饭点党',
    night.dimensions.dependence.value > noon.dimensions.dependence.value,
    `night=${night.dimensions.dependence.value.toFixed(3)} noon=${noon.dimensions.dependence.value.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// 7. 钠估算：覆盖率保护
// ---------------------------------------------------------------------------

{
  const nutri = [
    { productName: '巨无霸', sodium: '500', energyKcal: '550' },
    { productName: '中薯条', sodium: '165', energyKcal: '289' },
  ];
  const list = series(4, { menu: [[['巨无霸', 1]]] });
  const r = M.computeMValue(list, { now: NOW, nutrition: nutri });
  ok('营养表匹配成功 -> ok', r.sodium.ok === true, JSON.stringify(r.sodium));
  eq('营养表覆盖率 100%', r.sodium.coverage, 100);
  ok('覆盖率 100% -> reliable', r.sodium.reliable === true);
  near('钠总量 = 500 * 4', r.sodium.totalSodiumMg, 2000);
}

{
  // 商品全部匹配不上 -> 不估算
  const nutri = [{ productName: '完全不存在的餐品名', sodium: '100', energyKcal: '100' }];
  const r = M.computeMValue(series(5, { menu: [[['巨无霸', 1]]] }), { now: NOW, nutrition: nutri });
  eq('匹配失败 -> ok=false', r.sodium.ok, false);
}

{
  // 无营养表 -> 不崩溃、不估算
  const r = M.computeMValue(series(5), { now: NOW });
  eq('无营养表 -> ok=false', r.sodium.ok, false);
  ok('无营养表 -> reliable=false', r.sodium.reliable === false);
}

{
  // 覆盖率低时，不应出现钠相关洞察
  const nutri = [
    { productName: '巨无霸', sodium: '500', energyKcal: '550' },
  ];
  // 4 单里只有 1 单能匹配 -> 25% 覆盖率
  const list = [
    order('2026-01-01', 12, [['巨无霸', 1]]),
    order('2026-01-02', 12, [['神秘餐品A', 1]]),
    order('2026-01-03', 12, [['神秘餐品B', 1]]),
    order('2026-01-04', 12, [['神秘餐品C', 1]]),
  ];
  const r = M.computeMValue(list, { now: NOW, nutrition: nutri });
  eq('低覆盖率 25%', r.sodium.coverage, 25);
  eq('低覆盖率 -> reliable=false', r.sodium.reliable, false);
  const hasSodiumInsight = r.insights.some(x => x.title.indexOf('钠') >= 0);
  eq('低覆盖率 -> 不输出钠洞察', hasSodiumInsight, false);
}

// ---------------------------------------------------------------------------
// 8. 等级边界
// ---------------------------------------------------------------------------

{
  const tiers = [
    [100, 'saint'], [90, 'saint'], [89, 'devotee'], [75, 'devotee'],
    [74, 'regular'], [60, 'regular'], [59, 'casual'], [40, 'casual'],
    [39, 'tourist'], [20, 'tourist'], [19, 'alien'], [0, 'alien'],
  ];
  tiers.forEach(([score, expected]) => {
    eq(`等级映射 ${score} -> ${expected}`, M.pickTier(score).key, expected);
  });
}

// ---------------------------------------------------------------------------
// 9. 洞察质量
// ---------------------------------------------------------------------------

{
  const r = M.computeMValue(series(10), { now: NOW });
  ok('洞察条数 <= 5', r.insights.length <= 5, `实际 ${r.insights.length}`);
  ok('洞察至少 1 条', r.insights.length >= 1);
  r.insights.forEach((x, i) => {
    ok(`洞察 ${i} 有 icon`, typeof x.icon === 'string' && x.icon.length > 0);
    ok(`洞察 ${i} 有 title`, typeof x.title === 'string' && x.title.length > 0);
    ok(`洞察 ${i} 有 text`, typeof x.text === 'string' && x.text.length > 0);
    ok(`洞察 ${i} 无 NaN`, x.title.indexOf('NaN') < 0 && x.text.indexOf('NaN') < 0,
      `${x.title} | ${x.text}`);
    ok(`洞察 ${i} 无 undefined`, x.title.indexOf('undefined') < 0 && x.text.indexOf('undefined') < 0);
  });
}

{
  // 单笔订单场景不应产生"平均间隔 0 天"这种无意义文案
  const r = M.computeMValue(series(3, { gapDays: 0 }), { now: NOW });
  const gapInsight = r.insights.find(x => x.title.indexOf('平均每') >= 0);
  ok('同日多单：间隔洞察文案合理',
    !gapInsight || gapInsight.text.indexOf('NaN') < 0, JSON.stringify(gapInsight));
}

// ---------------------------------------------------------------------------
// 10. 统计字段完整性
// ---------------------------------------------------------------------------

{
  const r = M.computeMValue(series(10), { now: NOW });
  const s = r.stats;
  ok('stats.orderCount 正确', s.orderCount === 10, `实际 ${s.orderCount}`);
  eq('hourHist 长度 24', s.hourHist.length, 24);
  eq('hourHist 总和 = 订单数', s.hourHist.reduce((a, b) => a + b, 0), 10);
  ok('firstOrder 格式正确', /^\d{4}-\d{2}-\d{2}$/.test(s.firstOrder), s.firstOrder);
  ok('lastOrder 格式正确', /^\d{4}-\d{2}-\d{2}$/.test(s.lastOrder), s.lastOrder);
  ok('topItems 非空', s.topItems.length > 0);
  ok('topStores 非空', s.topStores.length > 0);
  ok('spanDays >= 0', s.spanDays >= 0);
}

// ---------------------------------------------------------------------------
// 11. 真实数据回归（基于 MCP 实际返回的结构）
// ---------------------------------------------------------------------------

{
  // 复刻 MCP 真实返回结构：金额是字符串、有多余字段、含退款单
  // 订单号已脱敏，仅保留结构特征
  const real = [
    {
      orderId: '10301571900XXXXXXXXXXXXXXX055',
      orderType: '1',
      createTime: '2026-08-29 17:01:15',
      beType: '1',
      beCode: '',
      storeCode: '1990190',
      storeName: '麦当劳南通通州万达餐厅',
      orderStatus: '订单已完成',
      realTotalAmount: '3',
      orderProductList: [{ productCode: '521797', productName: '北美招牌牧场酱', quantity: 1 }],
    },
    {
      orderId: '10301571900XXXXXXXXXXXXXXX056',
      orderType: '1',
      createTime: '2026-08-29 17:00:38',
      storeCode: '1990190',
      storeName: '麦当劳南通通州万达餐厅',
      orderStatus: '订单已完成',
      realTotalAmount: '0',
      orderProductList: [{ productCode: '521798', productName: '麦乐鸡买一送一', quantity: 1 }],
    },
    {
      orderId: '10301571900XXXXXXXXXXXXXXX057',
      orderType: '1',
      createTime: '2026-02-19 18:04:07',
      storeCode: '1990200',
      storeName: '太仓万达独立甜品站',
      orderStatus: '部分退款',
      realTotalAmount: '24',
      orderProductList: [{ productCode: '521799', productName: '云朵棉花糖麦旋风', quantity: 2 }],
    },
  ];
  const r = M.computeMValue(real, { now: NOW });
  eq('真实结构：3 单全部有效', r.orderCount, 3);
  eq('真实结构：能算出分数', r.ok, true);
  ok('真实结构：分数在值域内', r.mValue >= 0 && r.mValue <= 100);
  eq('真实结构：0 元单被识别', r.stats.freeOrderCount, 1);
  near('真实结构：累计自付 27 元', r.stats.totalSpent, 27);
}

// ---------------------------------------------------------------------------
// 12. 性能：大量订单不应卡住
// ---------------------------------------------------------------------------

{
  const big = series(200, { gapDays: 1, menu: [[['巨无霸', 1], ['中薯条', 1]]] });
  const t0 = Date.now();
  const r = M.computeMValue(big, { now: NOW });
  const cost = Date.now() - t0;
  ok('200 单计算耗时 < 200ms', cost < 200, `实际 ${cost}ms`);
  eq('200 单订单数正确', r.orderCount, 200);
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

console.log('');
console.log('='.repeat(56));
console.log(`  通过 ${pass}  ·  失败 ${fail}`);
console.log('='.repeat(56));

if (fail > 0) {
  console.log('\n失败用例：');
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('');
  process.exit(1);
} else {
  console.log('\n全部通过。\n');
}
