(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StudyEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const TARGET_RETENTION = 0.9;
  const MAX_INTERVAL = 365;
  const STAGES = Object.freeze([
    { stage: 0, label: '未学习', mastery: 0, interval: 0 },
    { stage: 1, label: '初识', mastery: 20, interval: 1 },
    { stage: 2, label: '学习中', mastery: 40, interval: 3 },
    { stage: 3, label: '巩固中', mastery: 60, interval: 7 },
    { stage: 4, label: '基本掌握', mastery: 80, interval: 14 },
    { stage: 5, label: '已掌握', mastery: 100, interval: 30 }
  ]);

  function dateKey(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDate(value) {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
      ? `${value}T00:00:00`
      : value;
    const parsed = new Date(normalized || Date.now());
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  function addDays(value, count) {
    const date = parseDate(value);
    date.setDate(date.getDate() + count);
    return dateKey(date);
  }

  function diffDays(from, to) {
    const start = parseDate(from);
    const end = parseDate(to);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return Math.round((end - start) / DAY_MS);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function round(value, digits = 2) {
    const scale = 10 ** digits;
    return Math.round(Number(value || 0) * scale) / scale;
  }

  function defaultStability(stage) {
    return stage > 0 ? Math.max(1, stageMeta(stage).interval) : 0;
  }

  function stageForStability(stability) {
    const value = Math.max(0, Number(stability) || 0);
    if (value < 1) return 0;
    if (value < 3) return 1;
    if (value < 7) return 2;
    if (value < 14) return 3;
    if (value < 30) return 4;
    return 5;
  }

  function maxStabilityForStage(stage) {
    return [0, 2.99, 6.99, 13.99, 29.99, MAX_INTERVAL][Math.round(clamp(stage, 0, 5))];
  }

  function createProgress(questionId, legacyWrongCount = 0, dueDate = null) {
    const seeded = legacyWrongCount > 0;
    const legacyDifficulty = seeded ? clamp(5.5 + Math.min(legacyWrongCount, 5) * 0.35, 1, 10) : 5;
    return {
      questionId: String(questionId),
      stage: seeded ? 1 : 0,
      firstSeenAt: null,
      lastSeenAt: null,
      lastResult: seeded ? 'legacy-wrong' : null,
      dueDate: seeded ? dueDate : null,
      correctCount: 0,
      wrongCount: 0,
      streak: 0,
      unfamiliarCount: 0,
      legacyWrongCount: Math.max(0, Number(legacyWrongCount) || 0),
      difficulty: round(legacyDifficulty),
      stability: seeded ? 1 : 0,
      lastInterval: seeded ? 1 : 0,
      reviewCount: 0,
      lapseCount: 0,
      retrievabilityAtReview: null,
      memoryVersion: 2
    };
  }

  function normalizeProgress(progress) {
    const source = progress || {};
    const base = createProgress(source.questionId || '', source.legacyWrongCount || 0, source.dueDate || null);
    const stage = Math.round(clamp(source.stage, 0, 5));
    const inferredStability = defaultStability(stage);
    const stability = stage > 0
      ? clamp(Number(source.stability) > 0 ? source.stability : inferredStability, 1, MAX_INTERVAL)
      : 0;
    return {
      ...base,
      ...source,
      questionId: String(source.questionId || base.questionId),
      stage,
      difficulty: round(clamp(Number(source.difficulty) > 0 ? source.difficulty : base.difficulty, 1, 10)),
      stability: round(stability),
      lastInterval: Math.max(0, Number(source.lastInterval) || inferredStability),
      reviewCount: Math.max(0, Number(source.reviewCount) || 0),
      lapseCount: Math.max(0, Number(source.lapseCount) || 0),
      memoryVersion: 2
    };
  }

  function reconcileProgress(questionIds, currentProgress, errorBook, today) {
    const existing = currentProgress && typeof currentProgress === 'object' ? currentProgress : {};
    const errors = new Map((errorBook || []).map(entry => [String(entry.questionId), entry]));
    const next = {};
    (questionIds || []).forEach(rawId => {
      const id = String(rawId);
      const previous = existing[id];
      if (previous) {
        next[id] = normalizeProgress({
          ...createProgress(id),
          ...previous,
          questionId: id,
          stage: clamp(previous.stage, 0, 5)
        });
        return;
      }
      const error = errors.get(id);
      next[id] = createProgress(id, error?.wrongCount || 0, dateKey(today));
    });
    return next;
  }

  function stageMeta(stage) {
    return STAGES[Math.round(clamp(stage, 0, 5))];
  }

  function recallProbability(progress, today) {
    const item = normalizeProgress(progress);
    if (item.stage === 0 || !item.lastSeenAt || item.stability <= 0) return 0;
    const elapsed = Math.max(0, diffDays(item.lastSeenAt, dateKey(today)));
    return round(clamp(TARGET_RETENTION ** (elapsed / item.stability), 0, 1), 4);
  }

  function nextDifficulty(previous, grade, retrievability) {
    const current = normalizeProgress(previous).difficulty;
    let change = 0;
    if (grade === 'again') change = 0.9 + retrievability * 0.35;
    else if (grade === 'hard') change = 0.35;
    else change = -0.18 - Math.max(0, TARGET_RETENTION - retrievability) * 0.45;
    return round(clamp(current + change, 1, 10));
  }

  function nextStability(previous, grade, retrievability, difficulty) {
    const item = normalizeProgress(previous);
    if (item.stage === 0) {
      if (grade === 'again') return 1;
      if (grade === 'hard') return 1.25;
      return 2;
    }

    const current = Math.max(1, item.stability || defaultStability(item.stage));
    if (grade === 'again') {
      return round(clamp(current * (0.32 + (10 - difficulty) * 0.012), 1, MAX_INTERVAL));
    }
    if (grade === 'hard') {
      const hardGrowth = 1.08 + Math.max(0, TARGET_RETENTION - retrievability) * 0.35;
      return round(clamp(current * hardGrowth, 1, MAX_INTERVAL));
    }

    const difficultyGrowth = (10 - difficulty) * 0.09;
    const recallGrowth = Math.max(0, TARGET_RETENTION - retrievability) * 1.1;
    const streakGrowth = Math.min(0.24, item.streak * 0.03);
    const growth = clamp(1.42 + difficultyGrowth + recallGrowth + streakGrowth, 1.35, 3.2);
    return round(clamp(current * growth, 1, MAX_INTERVAL));
  }

  function applyPlannedResult(progress, result) {
    const today = dateKey(result.date);
    const previous = normalizeProgress({ ...createProgress(progress.questionId), ...progress });
    const wasUnseen = previous.stage === 0;
    const correct = Boolean(result.correct);
    const familiar = correct && result.familiar !== false;
    const grade = !correct ? 'again' : (familiar ? 'good' : 'hard');
    const retrievability = wasUnseen ? 0 : recallProbability(previous, today);
    const difficulty = nextDifficulty(previous, grade, retrievability);
    let stability = nextStability(previous, grade, retrievability, difficulty);
    const stabilityStage = Math.max(1, stageForStability(stability));
    let stage;
    let interval;

    if (wasUnseen) {
      stage = 1;
      interval = grade === 'good' ? Math.max(1, Math.round(stability)) : 1;
    } else if (!correct) {
      stage = Math.min(stabilityStage, Math.max(1, previous.stage - 2));
      stability = Math.min(stability, maxStabilityForStage(stage));
      interval = 1;
    } else if (!familiar) {
      stage = Math.max(1, previous.stage);
      stability = Math.min(stability, maxStabilityForStage(stage));
      interval = previous.stage >= 4
        ? Math.min(7, Math.max(3, Math.round(stability * 0.35)))
        : 1;
    } else {
      stage = Math.max(previous.stage, stabilityStage);
      interval = Math.max(1, Math.min(MAX_INTERVAL, Math.round(stability)));
    }

    return {
      ...previous,
      stage,
      firstSeenAt: previous.firstSeenAt || today,
      lastSeenAt: today,
      lastResult: !correct ? 'wrong' : (familiar ? 'correct' : 'unfamiliar'),
      dueDate: addDays(today, interval),
      correctCount: previous.correctCount + (correct ? 1 : 0),
      wrongCount: previous.wrongCount + (correct ? 0 : 1),
      streak: correct ? previous.streak + 1 : 0,
      unfamiliarCount: previous.unfamiliarCount + (correct && !familiar ? 1 : 0),
      difficulty,
      stability,
      lastInterval: interval,
      reviewCount: previous.reviewCount + 1,
      lapseCount: previous.lapseCount + (correct ? 0 : 1),
      retrievabilityAtReview: retrievability,
      memoryVersion: 2
    };
  }

  function applyIncidentalResult(progress, result) {
    const today = dateKey(result.date);
    const previous = normalizeProgress({ ...createProgress(progress.questionId), ...progress });
    const correct = Boolean(result.correct);
    const retrievability = previous.stage === 0 ? 0 : recallProbability(previous, today);
    const difficulty = nextDifficulty(previous, correct ? 'good' : 'again', retrievability);
    let stage = previous.stage;
    let dueDate = previous.dueDate;
    let stability = previous.stability;

    if (previous.stage === 0) {
      stage = 1;
      dueDate = addDays(today, 1);
      stability = correct ? 1.5 : 1;
    } else if (!correct) {
      stability = round(clamp(Math.max(1, previous.stability) * 0.55, 1, MAX_INTERVAL));
      stage = Math.min(Math.max(1, previous.stage - 1), Math.max(1, stageForStability(stability)));
      dueDate = addDays(today, 1);
    } else {
      stability = round(clamp(
        Math.max(1, previous.stability) * (1.03 + Math.max(0, TARGET_RETENTION - retrievability) * 0.15),
        1,
        MAX_INTERVAL
      ));
      stability = Math.min(stability, maxStabilityForStage(stage));
    }

    return {
      ...previous,
      stage,
      firstSeenAt: previous.firstSeenAt || today,
      lastSeenAt: today,
      lastResult: correct ? 'correct-practice' : 'wrong-practice',
      dueDate,
      correctCount: previous.correctCount + (correct ? 1 : 0),
      wrongCount: previous.wrongCount + (correct ? 0 : 1),
      streak: correct ? previous.streak + 1 : 0,
      difficulty,
      stability,
      lastInterval: previous.stage === 0 || !correct ? 1 : previous.lastInterval,
      reviewCount: previous.reviewCount + 1,
      lapseCount: previous.lapseCount + (correct ? 0 : 1),
      retrievabilityAtReview: retrievability,
      memoryVersion: 2
    };
  }

  function scheduleDay(plan, questionIds, progressById, today, completedIds) {
    const date = dateKey(today);
    const totalLimit = Math.max(1, Number(plan?.dailyTotalLimit) || 30);
    const newLimit = Math.max(0, Number(plan?.dailyNewLimit) || 0);
    const completed = new Set(completedIds || []);
    const order = new Map((questionIds || []).map((id, index) => [String(id), index]));
    const priorityOrder = new Map((plan?.priorityQuestionIds || []).map((id, index) => [String(id), index]));
    const progress = progressById || {};

    function comparePriority(a, b) {
      const rankA = priorityOrder.has(a) ? priorityOrder.get(a) : Number.MAX_SAFE_INTEGER;
      const rankB = priorityOrder.has(b) ? priorityOrder.get(b) : Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    }

    const due = (questionIds || []).map(String).filter(id => {
      const item = progress[id];
      return item && item.stage > 0 && item.dueDate && item.dueDate <= date && !completed.has(id);
    }).sort((a, b) => {
      const itemA = progress[a];
      const itemB = progress[b];
      const recallCompare = recallProbability(itemA, date) - recallProbability(itemB, date);
      if (Math.abs(recallCompare) > 0.0001) return recallCompare;
      const dueCompare = String(itemA.dueDate).localeCompare(String(itemB.dueDate));
      if (dueCompare) return dueCompare;
      if (itemA.stage !== itemB.stage) return itemA.stage - itemB.stage;
      const weakA = /wrong|unfamiliar/.test(itemA.lastResult || '') ? 0 : 1;
      const weakB = /wrong|unfamiliar/.test(itemB.lastResult || '') ? 0 : 1;
      if (weakA !== weakB) return weakA - weakB;
      const priorityCompare = comparePriority(a, b);
      if (priorityCompare) return priorityCompare;
      return order.get(a) - order.get(b);
    });

    const reviewIds = due.slice(0, totalLimit);
    const remaining = Math.max(0, totalLimit - reviewIds.length);
    const unseen = (questionIds || []).map(String).filter(id => {
      const item = progress[id];
      return (!item || item.stage === 0) && !completed.has(id);
    }).sort((a, b) => comparePriority(a, b) || order.get(a) - order.get(b));
    const remainingDays = Math.max(1, diffDays(date, plan?.targetDate || date) + 1);
    const neededNew = unseen.length ? Math.ceil(unseen.length / remainingDays) : 0;
    const newCount = Math.min(newLimit, remaining, neededNew);
    const newIds = unseen.slice(0, newCount);

    return {
      date,
      reviewIds,
      newIds,
      questionIds: reviewIds.concat(newIds),
      dueTotal: due.length,
      overdueCarry: Math.max(0, due.length - reviewIds.length),
      unseenTotal: unseen.length,
      neededNew,
      totalLimit,
      newLimit
    };
  }

  function simulate(plan, questionIds, progressById, today, target, maxDays) {
    const ids = (questionIds || []).map(String);
    let progress = Object.fromEntries(ids.map(id => [id, { ...createProgress(id), ...(progressById?.[id] || {}) }]));
    let date = dateKey(today);
    for (let day = 0; day <= maxDays; day++) {
      const reached = target === 'first-pass'
        ? ids.every(id => progress[id].stage > 0)
        : ids.every(id => progress[id].stage >= 5);
      if (reached) return { date, days: day };
      const schedule = scheduleDay(plan, ids, progress, date);
      if (!schedule.questionIds.length) {
        date = addDays(date, 1);
        continue;
      }
      schedule.reviewIds.forEach(id => {
        progress[id] = applyPlannedResult(progress[id], { correct: true, familiar: true, date });
      });
      schedule.newIds.forEach(id => {
        progress[id] = applyPlannedResult(progress[id], { correct: true, familiar: true, date });
      });
      date = addDays(date, 1);
    }
    return null;
  }

  function forecastFirstPass(plan, questionIds, progressById, today) {
    return simulate(plan, questionIds, progressById, today, 'first-pass', 3650)?.date || null;
  }

  function forecastMastery(plan, questionIds, progressById, today, completedDayCount) {
    if ((Number(completedDayCount) || 0) < 3) return null;
    return simulate(plan, questionIds, progressById, today, 'mastery', 3650)?.date || null;
  }

  function forecastLoad(plan, questionIds, progressById, today, days) {
    const ids = (questionIds || []).map(String);
    let progress = Object.fromEntries(ids.map(id => [id, { ...createProgress(id), ...(progressById?.[id] || {}) }]));
    let date = dateKey(today);
    const result = [];
    for (let index = 0; index < (days || 7); index++) {
      const schedule = scheduleDay(plan, ids, progress, date);
      result.push({
        date,
        review: schedule.reviewIds.length,
        fresh: schedule.newIds.length,
        total: schedule.questionIds.length,
        carry: schedule.overdueCarry
      });
      schedule.reviewIds.forEach(id => {
        progress[id] = applyPlannedResult(progress[id], { correct: true, familiar: true, date });
      });
      schedule.newIds.forEach(id => {
        progress[id] = applyPlannedResult(progress[id], { correct: true, familiar: true, date });
      });
      date = addDays(date, 1);
    }
    return result;
  }

  function overview(questionIds, progressById, today) {
    const ids = (questionIds || []).map(String);
    const items = ids.map(id => normalizeProgress(progressById?.[id] || createProgress(id)));
    const learned = items.filter(item => item.stage > 0);
    const mastered = items.filter(item => item.stage >= 5);
    const due = learned.filter(item => item.dueDate && item.dueDate <= dateKey(today));
    const mastery = learned.length
      ? Math.round(learned.reduce((sum, item) => sum + stageMeta(item.stage).mastery, 0) / learned.length)
      : 0;
    const retention = learned.length
      ? Math.round(learned.reduce((sum, item) => sum + recallProbability(item, today), 0) / learned.length * 100)
      : 0;
    return {
      total: ids.length,
      learned: learned.length,
      unseen: ids.length - learned.length,
      mastered: mastered.length,
      due: due.length,
      coverage: ids.length ? Math.round(learned.length / ids.length * 100) : 0,
      mastery,
      retention
    };
  }

  function weakChapters(questions, progressById, dailyRecords, today) {
    const since = addDays(today, -29);
    const groups = new Map();
    (questions || []).forEach(question => {
      const chapter = question.chapter || '未分类';
      if (!groups.has(chapter)) groups.set(chapter, []);
      groups.get(chapter).push(question);
    });

    return [...groups.entries()].map(([chapter, chapterQuestions]) => {
      const ids = new Set(chapterQuestions.map(question => String(question.id)));
      const learned = chapterQuestions.map(question => progressById?.[String(question.id)])
        .filter(item => item && item.stage > 0)
        .map(normalizeProgress);
      if (learned.length < 5) return null;
      const mastery = learned.reduce((sum, item) => sum + stageMeta(item.stage).mastery, 0) / learned.length;
      const outcomes = (dailyRecords || []).filter(record => record.date >= since)
        .flatMap(record => record.results || [])
        .filter(result => ids.has(String(result.questionId)));
      const accuracy = outcomes.length
        ? outcomes.filter(result => result.correct).length / outcomes.length * 100
        : mastery;
      const overdue = learned.filter(item => item.dueDate && item.dueDate <= dateKey(today)).length;
      const retention = learned.reduce((sum, item) => sum + recallProbability(item, today), 0) / learned.length * 100;
      const weakness = 0.4 * (100 - mastery) + 0.25 * (100 - accuracy) + 0.35 * (100 - retention);
      return {
        chapter,
        learned: learned.length,
        total: chapterQuestions.length,
        mastery: Math.round(mastery),
        accuracy: Math.round(accuracy),
        retention: Math.round(retention),
        overdue,
        weakness: Math.round(weakness)
      };
    }).filter(Boolean).sort((a, b) => b.weakness - a.weakness || a.mastery - b.mastery);
  }

  return Object.freeze({
    STAGES,
    dateKey,
    addDays,
    diffDays,
    createProgress,
    normalizeProgress,
    reconcileProgress,
    stageMeta,
    stageForStability,
    recallProbability,
    applyPlannedResult,
    applyIncidentalResult,
    scheduleDay,
    forecastFirstPass,
    forecastMastery,
    forecastLoad,
    overview,
    weakChapters
  });
});
