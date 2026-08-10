const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../study-engine.js');

const ids = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];

test('旧错题只作为初始弱项，不伪造正式学习历史', () => {
  const progress = engine.reconcileProgress(ids, {}, [{ questionId: 'q2', wrongCount: 3 }], '2026-08-10');
  assert.equal(progress.q1.stage, 0);
  assert.equal(progress.q2.stage, 1);
  assert.equal(progress.q2.legacyWrongCount, 3);
  assert.equal(progress.q2.firstSeenAt, null);
  assert.equal(progress.q2.dueDate, '2026-08-10');
});

test('到期复习优先占用总量，复习超限时新题为零', () => {
  const progress = engine.reconcileProgress(ids, {}, [], '2026-08-10');
  ids.slice(0, 4).forEach(id => {
    progress[id] = { ...progress[id], stage: 2, dueDate: '2026-08-09' };
  });
  const schedule = engine.scheduleDay(
    { targetDate: '2026-08-20', dailyNewLimit: 2, dailyTotalLimit: 3 },
    ids,
    progress,
    '2026-08-10'
  );
  assert.deepEqual(schedule.reviewIds, ['q1', 'q2', 'q3']);
  assert.equal(schedule.newIds.length, 0);
  assert.equal(schedule.overdueCarry, 1);
});

test('每日新题同时受新题上限、总题量和首轮所需速度限制', () => {
  const progress = engine.reconcileProgress(ids, {}, [], '2026-08-10');
  const schedule = engine.scheduleDay(
    { targetDate: '2026-08-12', dailyNewLimit: 5, dailyTotalLimit: 4 },
    ids,
    progress,
    '2026-08-10'
  );
  assert.equal(schedule.neededNew, 2);
  assert.deepEqual(schedule.newIds, ['q1', 'q2']);
});

test('计划复习答错回退两级且次日到期', () => {
  const before = { ...engine.createProgress('q1'), stage: 4, dueDate: '2026-08-10' };
  const after = engine.applyPlannedResult(before, { correct: false, date: '2026-08-10' });
  assert.equal(after.stage, 2);
  assert.equal(after.dueDate, '2026-08-11');
  assert.equal(after.wrongCount, 1);
});

test('正确但主观不熟练不会升级掌握阶段', () => {
  const before = { ...engine.createProgress('q1'), stage: 3, dueDate: '2026-08-10' };
  const after = engine.applyPlannedResult(before, { correct: true, familiar: false, date: '2026-08-10' });
  assert.equal(after.stage, 3);
  assert.equal(after.dueDate, '2026-08-11');
  assert.equal(after.unfamiliarCount, 1);
});

test('自由练习答对不推迟已有计划复习', () => {
  const before = { ...engine.createProgress('q1'), stage: 3, dueDate: '2026-08-12' };
  const after = engine.applyIncidentalResult(before, { correct: true, date: '2026-08-10' });
  assert.equal(after.stage, 3);
  assert.equal(after.dueDate, '2026-08-12');
});

test('首轮预测会诚实考虑未来复习占用', () => {
  const progress = engine.reconcileProgress(ids, {}, [], '2026-08-10');
  const forecast = engine.forecastFirstPass(
    { targetDate: '2026-08-12', dailyNewLimit: 2, dailyTotalLimit: 3 },
    ids,
    progress,
    '2026-08-10'
  );
  assert.equal(forecast, '2026-08-14');
});

test('总题量过低且长期被复习占满时不伪造完成日期', () => {
  const manyIds = Array.from({ length: 320 }, (_, index) => `low-${index}`);
  const progress = engine.reconcileProgress(manyIds, {}, [], '2026-08-10');
  const forecast = engine.forecastFirstPass(
    { targetDate: '2026-10-10', dailyNewLimit: 3, dailyTotalLimit: 3 },
    manyIds,
    progress,
    '2026-08-10'
  );
  assert.equal(forecast, null);
});

test('薄弱统计忽略学习不足五题的章节', () => {
  const questions = ids.map((id, index) => ({ id, chapter: index < 4 ? '章节甲' : '章节乙' }));
  const progress = engine.reconcileProgress(ids, {}, [], '2026-08-10');
  ids.forEach(id => { progress[id] = { ...progress[id], stage: 2, dueDate: '2026-08-10' }; });
  const weak = engine.weakChapters(questions, progress, [], '2026-08-10');
  assert.deepEqual(weak, []);
});
