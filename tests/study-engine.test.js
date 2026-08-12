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
  assert.equal(progress.q2.memoryVersion, 2);
  assert.equal(progress.q2.stability, 1);
  assert.ok(progress.q2.difficulty > progress.q1.difficulty);
});

test('旧版阶段记录会自动补齐自适应记忆参数', () => {
  const progress = engine.reconcileProgress(ids, {
    q1: { questionId: 'q1', stage: 4, dueDate: '2026-08-20' }
  }, [], '2026-08-10');
  assert.equal(progress.q1.memoryVersion, 2);
  assert.equal(progress.q1.stability, 14);
  assert.equal(progress.q1.difficulty, 5);
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

test('勾选的复习章节会优先安排首轮新题', () => {
  const progress = engine.reconcileProgress(ids, {}, [], '2026-08-10');
  const schedule = engine.scheduleDay(
    {
      targetDate: '2026-08-12',
      dailyNewLimit: 2,
      dailyTotalLimit: 4,
      priorityQuestionIds: ['q5', 'q4']
    },
    ids,
    progress,
    '2026-08-10'
  );
  assert.deepEqual(schedule.newIds, ['q5', 'q4']);
});

test('章节优先不会越过记忆风险更高的到期复习', () => {
  const progress = engine.reconcileProgress(ids, {}, [], '2026-08-10');
  progress.q1 = { ...progress.q1, stage: 2, stability: 3, lastSeenAt: '2026-08-01', dueDate: '2026-08-04' };
  progress.q2 = { ...progress.q2, stage: 2, stability: 3, lastSeenAt: '2026-08-07', dueDate: '2026-08-10' };
  const schedule = engine.scheduleDay(
    {
      targetDate: '2026-08-20',
      dailyNewLimit: 0,
      dailyTotalLimit: 1,
      priorityQuestionIds: ['q2']
    },
    ids,
    progress,
    '2026-08-10'
  );
  assert.deepEqual(schedule.reviewIds, ['q1']);
});

test('计划复习答错回退两级且次日到期', () => {
  const before = { ...engine.createProgress('q1'), stage: 4, dueDate: '2026-08-10' };
  const after = engine.applyPlannedResult(before, { correct: false, date: '2026-08-10' });
  assert.equal(after.stage, 2);
  assert.equal(after.dueDate, '2026-08-11');
  assert.equal(after.wrongCount, 1);
});

test('高阶段答错后会逐步恢复，不会一次答对直接跳回原阶段', () => {
  const before = {
    ...engine.createProgress('q1'),
    stage: 5,
    stability: 45,
    difficulty: 4,
    lastSeenAt: '2026-07-01',
    dueDate: '2026-08-10'
  };
  const failed = engine.applyPlannedResult(before, { correct: false, date: '2026-08-10' });
  const recovered = engine.applyPlannedResult(failed, { correct: true, familiar: true, date: '2026-08-11' });
  assert.equal(failed.stage, 3);
  assert.equal(recovered.stage, 4);
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

test('答对低回忆概率题会获得更大的稳定度增长', () => {
  const recent = {
    ...engine.createProgress('recent'),
    stage: 2,
    stability: 3,
    difficulty: 5,
    lastSeenAt: '2026-08-09',
    dueDate: '2026-08-12'
  };
  const overdue = { ...recent, questionId: 'overdue', lastSeenAt: '2026-07-25', dueDate: '2026-07-28' };
  const recentAfter = engine.applyPlannedResult(recent, { correct: true, familiar: true, date: '2026-08-10' });
  const overdueAfter = engine.applyPlannedResult(overdue, { correct: true, familiar: true, date: '2026-08-10' });
  assert.ok(overdueAfter.retrievabilityAtReview < recentAfter.retrievabilityAtReview);
  assert.ok(overdueAfter.stability > recentAfter.stability);
  assert.ok(engine.diffDays('2026-08-10', overdueAfter.dueDate) > engine.diffDays('2026-08-10', recentAfter.dueDate));
});

test('较难题在相同记忆状态下获得更短的复习间隔', () => {
  const base = {
    ...engine.createProgress('q1'),
    stage: 3,
    stability: 7,
    lastSeenAt: '2026-08-03',
    dueDate: '2026-08-10'
  };
  const easy = engine.applyPlannedResult({ ...base, difficulty: 3 }, { correct: true, familiar: true, date: '2026-08-10' });
  const hard = engine.applyPlannedResult({ ...base, difficulty: 8 }, { correct: true, familiar: true, date: '2026-08-10' });
  assert.ok(easy.lastInterval > hard.lastInterval);
});

test('计划排题优先处理回忆概率更低的到期题', () => {
  const progress = engine.reconcileProgress(ids, {}, [], '2026-08-10');
  progress.q1 = {
    ...progress.q1,
    stage: 5,
    stability: 30,
    lastSeenAt: '2026-07-02',
    dueDate: '2026-08-01'
  };
  progress.q2 = {
    ...progress.q2,
    stage: 2,
    stability: 3,
    lastSeenAt: '2026-08-02',
    dueDate: '2026-08-05'
  };
  const schedule = engine.scheduleDay(
    { targetDate: '2026-08-20', dailyNewLimit: 0, dailyTotalLimit: 1 },
    ids,
    progress,
    '2026-08-10'
  );
  assert.deepEqual(schedule.reviewIds, ['q2']);
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

test('总题量过低时自适应预测会诚实给出大幅顺延日期', () => {
  const manyIds = Array.from({ length: 320 }, (_, index) => `low-${index}`);
  const progress = engine.reconcileProgress(manyIds, {}, [], '2026-08-10');
  const forecast = engine.forecastFirstPass(
    { targetDate: '2026-10-10', dailyNewLimit: 3, dailyTotalLimit: 3 },
    manyIds,
    progress,
    '2026-08-10'
  );
  assert.ok(forecast);
  assert.ok(engine.diffDays('2026-10-10', forecast) > 365);
});

test('薄弱统计忽略学习不足五题的章节', () => {
  const questions = ids.map((id, index) => ({ id, chapter: index < 4 ? '章节甲' : '章节乙' }));
  const progress = engine.reconcileProgress(ids, {}, [], '2026-08-10');
  ids.forEach(id => { progress[id] = { ...progress[id], stage: 2, dueDate: '2026-08-10' }; });
  const weak = engine.weakChapters(questions, progress, [], '2026-08-10');
  assert.deepEqual(weak, []);
});

test('薄弱分析会把较低的预计记忆保持率计入风险', () => {
  const questions = ids.slice(0, 5).map(id => ({ id, chapter: '章节甲' }));
  const fresh = engine.reconcileProgress(ids, {}, [], '2026-08-10');
  ids.slice(0, 5).forEach(id => {
    fresh[id] = { ...fresh[id], stage: 3, stability: 7, lastSeenAt: '2026-08-10', dueDate: '2026-08-17' };
  });
  const stale = Object.fromEntries(Object.entries(fresh).map(([id, item]) => [
    id,
    ids.slice(0, 5).includes(id) ? { ...item, lastSeenAt: '2026-07-10', dueDate: '2026-07-17' } : item
  ]));
  const freshWeakness = engine.weakChapters(questions, fresh, [], '2026-08-10')[0];
  const staleWeakness = engine.weakChapters(questions, stale, [], '2026-08-10')[0];
  assert.ok(staleWeakness.retention < freshWeakness.retention);
  assert.ok(staleWeakness.weakness > freshWeakness.weakness);
});
