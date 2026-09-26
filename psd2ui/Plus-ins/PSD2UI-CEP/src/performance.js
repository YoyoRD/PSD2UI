'use strict';

// 只记录阶段、耗时和数据长度，不记录 PSD 名称、图层文本或配置内容。
const totals = Object.create(null);
const recent = [];
let sequence = 0;

function record(stage, milliseconds, size) {
  const total = totals[stage] || (totals[stage] = { count: 0, milliseconds: 0, maxMilliseconds: 0 });
  total.count++;
  total.milliseconds += milliseconds;
  total.maxMilliseconds = Math.max(total.maxMilliseconds, milliseconds);
  recent.push({ sequence: ++sequence, stage, milliseconds, size: size || 0 });
  if (recent.length > 120) recent.shift();
}

function snapshot() {
  return JSON.parse(JSON.stringify({ sequence, totals, recent }));
}

module.exports = { record, snapshot };
