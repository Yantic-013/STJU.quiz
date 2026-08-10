(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StudyEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
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

  function createProgress(questionId, legacyWrongCount = 0, dueDate = null) {
    const seeded = legacyWrongCount > 0;
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
      legacyWrongCount: Math.max(0, Number(legacyWrongCount) || 0)
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
        next[id] = {
          ...createProgress(id),
          ...previous,
          questionId: id,
          stage: clamp(previous.stage, 0, 5)
        };
        return;
      }
      const error = errors.get(id);
      next[id] = createProgress(id, error?.wrongCount || 0, dateKey(today));
    });
    return next;
  }

  function stageMeta(stage) {
    return STAGES[clamp(stage, 0, 5)];
  }

  function intervalFor(stage, repeatedMastery) {
    if (stage >= 5 && repeatedMastery) return 60;
    return stageMeta(stage).interval;
  }

  function applyPlannedResult(progress, result) {
    const today = dateKey(result.date);
    const previous = { ...createProgress(progress.questionId), ...progress };
    const wasUnseen = previous.stage === 0;
    const correct = Boolean(result.correct);
    const familiar = correct && result.familiar !== false;
    let stage = previous.stage;
    let interval = 1;

    if (wasUnseen) {
      stage = 1;
      interval = 1;
    } else if (!correct) {
      stage = Math.max(1, previous.stage - 2);
      interval = 1;
    } else if (!familiar) {
      stage = Math.max(1, previous.stage);
      interval = previous.stage >= 4 ? 3 : 1;
    } else {
      stage = Math.min(5, previous.stage + 1);
      interval = intervalFor(stage, previous.stage === 5);
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
      unfamiliarCount: previous.unfamiliarCount + (correct && !familiar ? 1 : 0)
    };
  }

  function applyIncidentalResult(progress, result) {
    const today = dateKey(result.date);
    const previous = { ...createProgress(progress.questionId), ...progress };
    const correct = Boolean(result.correct);
    let stage = previous.stage;
    let dueDate = previous.dueDate;

    if (previous.stage === 0) {
      stage = 1;
      dueDate = addDays(today, 1);
    } else if (!correct) {
      stage = Math.max(1, previous.stage - 1);
      dueDate = addDays(today, 1);
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
      streak: correct ? previous.streak + 1 : 0
    };
  }

  function scheduleDay(plan, questionIds, progressById, today, completedIds) {
    const date = dateKey(today);
    const totalLimit = Math.max(1, Number(plan?.dailyTotalLimit) || 30);
    const newLimit = Math.max(0, Number(plan?.dailyNewLimit) || 0);
    const completed = new Set(completedIds || []);
    const order = new Map((questionIds || []).map((id, index) => [String(id), index]));
    const progress = progressById || {};

    const due = (questionIds || []).map(String).filter(id => {
      const item = progress[id];
      return item && item.stage > 0 && item.dueDate && item.dueDate <= date && !completed.has(id);
    }).sort((a, b) => {
      const itemA = progress[a];
      const itemB = progress[b];
      const dueCompare = String(itemA.dueDate).localeCompare(String(itemB.dueDate));
      if (dueCompare) return dueCompare;
      if (itemA.stage !== itemB.stage) return itemA.stage - itemB.stage;
      const weakA = /wrong|unfamiliar/.test(itemA.lastResult || '') ? 0 : 1;
      const weakB = /wrong|unfamiliar/.test(itemB.lastResult || '') ? 0 : 1;
      if (weakA !== weakB) return weakA - weakB;
      return order.get(a) - order.get(b);
    });

    const reviewIds = due.slice(0, totalLimit);
    const remaining = Math.max(0, totalLimit - reviewIds.length);
    const unseen = (questionIds || []).map(String).filter(id => {
      const item = progress[id];
      return (!item || item.stage === 0) && !completed.has(id);
    });
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
    const items = ids.map(id => progressById?.[id] || createProgress(id));
    const learned = items.filter(item => item.stage > 0);
    const mastered = items.filter(item => item.stage >= 5);
    const due = learned.filter(item => item.dueDate && item.dueDate <= dateKey(today));
    const mastery = learned.length
      ? Math.round(learned.reduce((sum, item) => sum + stageMeta(item.stage).mastery, 0) / learned.length)
      : 0;
    return {
      total: ids.length,
      learned: learned.length,
      unseen: ids.length - learned.length,
      mastered: mastered.length,
      due: due.length,
      coverage: ids.length ? Math.round(learned.length / ids.length * 100) : 0,
      mastery
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
        .filter(item => item && item.stage > 0);
      if (learned.length < 5) return null;
      const mastery = learned.reduce((sum, item) => sum + stageMeta(item.stage).mastery, 0) / learned.length;
      const outcomes = (dailyRecords || []).filter(record => record.date >= since)
        .flatMap(record => record.results || [])
        .filter(result => ids.has(String(result.questionId)));
      const accuracy = outcomes.length
        ? outcomes.filter(result => result.correct).length / outcomes.length * 100
        : mastery;
      const overdue = learned.filter(item => item.dueDate && item.dueDate <= dateKey(today)).length;
      const overdueRatio = overdue / learned.length * 100;
      const weakness = 0.5 * (100 - mastery) + 0.3 * (100 - accuracy) + 0.2 * overdueRatio;
      return {
        chapter,
        learned: learned.length,
        total: chapterQuestions.length,
        mastery: Math.round(mastery),
        accuracy: Math.round(accuracy),
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
    reconcileProgress,
    stageMeta,
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
