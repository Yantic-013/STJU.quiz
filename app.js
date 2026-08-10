/* ================================================================
   数据层
   ================================================================ */
function $id(id) { return document.getElementById(id); }

// localforage 降级垫片逻辑，防止 CDN 加载失败报错
if (typeof localforage === 'undefined') {
  console.warn('localforage is not defined. Falling back to localStorage.');
  window.localforage = {
    getItem: function(key) {
      return new Promise((resolve) => {
        try {
          const val = localStorage.getItem(key);
          resolve(val ? JSON.parse(val) : null);
        } catch {
          resolve(null);
        }
      });
    },
    setItem: function(key, val) {
      return new Promise((resolve) => {
        try {
          localStorage.setItem(key, JSON.stringify(val));
        } catch {}
        resolve(val);
      });
    },
    removeItem: function(key) {
      return new Promise((resolve) => {
        try {
          localStorage.removeItem(key);
        } catch {}
        resolve();
      });
    }
  };
}

async function loadData(key) {
  try {
    const val = await localforage.getItem(key);
    return val;
  } catch {
    return null;
  }
}

async function saveData(key, data) {
  try {
    await localforage.setItem(key, data);
  } catch (e) {
    console.error(`Error saving data for ${key}:`, e);
  }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const QUESTION_TYPE_META = {
  single: { label: '单选题', shortLabel: '单选', tagClass: 'tag-single' },
  multi: { label: '多选题', shortLabel: '多选', tagClass: 'tag-multi' },
  fill: { label: '填空题', shortLabel: '填空', tagClass: 'tag-fill' }
};

function normalizeQuestionType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'multi' || type.includes('多选')) return 'multi';
  if (type === 'fill' || type.includes('填空')) return 'fill';
  return 'single';
}

function normalizeAnswerOrder(value) {
  const order = String(value || '').trim().toLowerCase();
  const flexibleLabels = ['any', 'unordered', '任意', '可交换', '无序', '不分顺序', '顺序不限'];
  return flexibleLabels.some(label => order === label || order.includes(label)) ? 'any' : 'fixed';
}

function questionTypeMeta(type) {
  return QUESTION_TYPE_META[normalizeQuestionType(type)];
}

function normalizeQuestion(question) {
  const type = normalizeQuestionType(question.type);
  const rawAnswer = Array.isArray(question.answer)
    ? question.answer
    : String(question.answer || '').split(/[,，]/);
  return {
    ...question,
    id: String(question.id || genId()),
    chapter: String(question.chapter || '未分类').trim() || '未分类',
    type,
    question: String(question.question || '').trim(),
    options: type === 'fill' ? [] : (Array.isArray(question.options) ? question.options.map(String) : []),
    answer: rawAnswer.map(value => String(value || '').trim()).filter(Boolean),
    answerOrder: type === 'fill' ? normalizeAnswerOrder(question.answerOrder) : 'fixed',
    explanation: String(question.explanation || '').trim(),
    image: String(question.image || '').trim()
  };
}

function countFillBlanks(question) {
  const matches = String(question.question || '').match(/_{3,}|＿{3,}/g);
  return Math.max(1, matches ? matches.length : (question.answer?.length || 1));
}

function parseFillAnswers(rawAnswer, question) {
  const raw = String(rawAnswer || '').trim();
  if (!raw) return [];
  const blankCount = countFillBlanks({ ...question, answer: [] });
  const parts = raw.split(/[,，;；]/).map(value => value.trim()).filter(Boolean);
  return blankCount > 1 && parts.length === blankCount ? parts : [raw];
}

function normalizeAnswerText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s,，。；;、:："“”'‘’（）()【】\[\]]+/g, '');
}

function isFillAnswerCorrect(userAnswer, correctAnswer, answerOrder = 'fixed') {
  const user = (userAnswer || []).map(normalizeAnswerText).filter(Boolean);
  const correct = (correctAnswer || []).map(value => String(value || '').trim()).filter(Boolean);
  const isFlexibleOrder = normalizeAnswerOrder(answerOrder) === 'any';
  if (!user.length || !correct.length) return false;

  if (user.length === correct.length) {
    if (isFlexibleOrder) {
      const expectedVariants = correct.map(expected =>
        expected.split(/[|｜/]/).map(normalizeAnswerText).filter(Boolean)
      );
      const used = new Array(user.length).fill(false);
      const matchNext = expectedIndex => {
        if (expectedIndex === expectedVariants.length) return true;
        for (let userIndex = 0; userIndex < user.length; userIndex++) {
          if (used[userIndex] || !expectedVariants[expectedIndex].includes(user[userIndex])) continue;
          used[userIndex] = true;
          if (matchNext(expectedIndex + 1)) return true;
          used[userIndex] = false;
        }
        return false;
      };
      return matchNext(0);
    }
    return correct.every((expected, index) => {
      const variants = expected.split(/[|｜/]/).map(normalizeAnswerText).filter(Boolean);
      return variants.includes(user[index]);
    });
  }

  if (isFlexibleOrder) return false;
  return normalizeAnswerText(user.join('')) === normalizeAnswerText(correct.join(''));
}

function hasUserAnswer(answer) {
  return Array.isArray(answer) && answer.some(value => String(value || '').trim());
}

function formatQuestionAnswer(question) {
  if (question.type === 'fill') return question.answer.join(' / ');
  return question.answer.join(', ');
}

const BUILTIN_QUESTION_IMAGES = Object.freeze({
  'JXSJ-02-006': './assets/question-images/JXSJ-02-006.webp',
  'JXSJ-02-007': './assets/question-images/JXSJ-02-007.webp',
  'JXSJ-02-010': './assets/question-images/JXSJ-02-010.webp',
  'JXSJ-02-021': './assets/question-images/JXSJ-02-021.webp',
  'JXSJ-03-005': './assets/question-images/JXSJ-03-005.webp',
  'JXSJ-03-016': './assets/question-images/JXSJ-03-016.webp',
  'JXSJ-04-019': './assets/question-images/JXSJ-04-019.webp',
  'JXSJ-09-018': './assets/question-images/JXSJ-09-018.webp',
  'JXSJ-10-004': './assets/question-images/JXSJ-10-004.webp',
  'JXSJ-10-013': './assets/question-images/JXSJ-10-013.webp',
  'JXSJ-10-014': './assets/question-images/JXSJ-10-014.webp',
  'JXSJ-10-015': './assets/question-images/JXSJ-10-015.webp',
  'JXSJ-11-020': './assets/question-images/JXSJ-11-020.webp',
  'JXSJ-12-005': './assets/question-images/JXSJ-12-005.webp',
  'MD-FILL-02-007': './assets/question-images/MD-FILL-02-007.webp',
  'MD-FILL-04-016': './assets/question-images/MD-FILL-04-016.webp',
  'MD-FILL-11-017': './assets/question-images/MD-FILL-11-017.webp',
  'MD-FILL-11-018': './assets/question-images/MD-FILL-11-018.webp',
  'MD-FILL-12-005': './assets/question-images/MD-FILL-12-005.webp',
  'JX-PM-021': './assets/question-images/JX-PM-021.webp',
  'JX-LG-028': './assets/question-images/JX-LG-028.webp',
  'JX-LG-029': './assets/question-images/JX-LG-029.webp',
  'JX-TL-014': './assets/question-images/JX-TL-014.webp',
  'JX-LX-015': './assets/question-images/JX-LX-015.webp',
  'JX-LX-016': './assets/question-images/JX-LX-016.webp',
  'JX-TK-LG-019': './assets/question-images/JX-TK-LG-019.webp',
  'JX-TK-LG-021': './assets/question-images/JX-TK-LG-021.webp',
  'JX-TK-LG-038': './assets/question-images/JX-TK-LG-038.webp',
  'JX-TK-LG-041': './assets/question-images/JX-TK-LG-041.webp',
  'JX-TK-CL-044': './assets/question-images/JX-TK-CL-044.webp',
  'JX-TK-CL-045': './assets/question-images/JX-TK-CL-045.webp',
  'JX-TK-LX-017': './assets/question-images/JX-TK-LX-017.webp'
});

function questionImageSource(question) {
  return questionImages[question.id] || question.image || BUILTIN_QUESTION_IMAGES[question.id] || '';
}

function renderQuestionImage(question, className = 'question-image') {
  const src = questionImageSource(question);
  if (!src) return '';
  return `<figure class="${className}"><img src="${escAttr(src)}" alt="${escAttr(question.id + ' 题图')}" loading="lazy"></figure>`;
}

const DEFAULT_QUESTIONS = window.DEFAULT_QUESTIONS || [];
const RETIRED_CHAPTERS = new Set(['第一章 绪论', '第二章 基础']);

let questionBank = [];
let errorBook = [];
let bookmarks = [];
let settings = {};
let questionImages = {};

// 异步加载与历史迁移
async function initData() {
  try {
    let qb = await loadData('questionBank');
    let eb = await loadData('errorBook');
    let bm = await loadData('bookmarks');
    let setts = await loadData('settings');
    let images = await loadData('questionImages');

    // 如果 IndexedDB 没有数据，且 localStorage 也没有旧数据，则自动加载内置默认题库
    let isNewUser = false;
    if (qb === null && !localStorage.getItem('questionBank')) {
      qb = DEFAULT_QUESTIONS;
      isNewUser = true;
    }

    // 如果 IndexedDB 没有数据，但 localStorage 中有旧数据，则执行无缝迁移
    let migrated = false;
    if (!qb && localStorage.getItem('questionBank')) {
      try {
        qb = JSON.parse(localStorage.getItem('questionBank')) || [];
        migrated = true;
      } catch (e) {}
    }
    if (!eb && localStorage.getItem('errorBook')) {
      try {
        eb = JSON.parse(localStorage.getItem('errorBook')) || [];
        migrated = true;
      } catch (e) {}
    }
    if (!setts && localStorage.getItem('settings')) {
      try {
        setts = JSON.parse(localStorage.getItem('settings')) || {};
        migrated = true;
      } catch (e) {}
    }

    questionBank = qb || [];
    errorBook = eb || [];
    bookmarks = bm || [];
    settings = setts || {};
    questionImages = images || {};

    // 数据库迁移与版本升级：清理早期默认数据并载入内置题库。
    if ((parseInt(String(settings.dbVersion || '').replace(/\D/g, ''), 10) || 0) < 12) {
      // 1. 清理已废弃的旧默认题库
      questionBank = questionBank.filter(q => !q.chapter.startsWith('机电系统二') && !q.id.startsWith('default_'));
      errorBook = errorBook.filter(e => questionBank.some(q => q.id === e.questionId));
      bookmarks = bookmarks.filter(id => questionBank.some(q => q.id === id));

      // 2. 按题目 ID 补齐默认题库，避免首次加载时重复追加。
      const existingIds = new Set(questionBank.map(question => String(question.id)));
      questionBank = questionBank.concat(
        DEFAULT_QUESTIONS.filter(question => !existingIds.has(String(question.id)))
      );
      settings.dbVersion = 'v12';
      migrated = true;
    }

    // v13：统一旧题型命名，并为填空题和题图字段补齐默认结构。
    if ((parseInt(String(settings.dbVersion || '').replace(/\D/g, ''), 10) || 0) < 13) {
      questionBank = questionBank.map(normalizeQuestion).filter(q => q.question);
      const validIds = new Set(questionBank.map(q => q.id));
      errorBook = errorBook.filter(entry => validIds.has(entry.questionId));
      bookmarks = bookmarks.filter(id => validIds.has(id));
      questionImages = Object.fromEntries(
        Object.entries(questionImages).filter(([id]) => validIds.has(id))
      );
      settings.dbVersion = 'v13';
      migrated = true;
    }

    // v14：删除旧“现代航空电子”默认库，改为机械设计与机械原理两套默认题库。
    if ((parseInt(String(settings.dbVersion || '').replace(/\D/g, ''), 10) || 0) < 14) {
      questionBank = questionBank.filter(question => {
        const source = String(question.source || '').trim();
        const chapter = String(question.chapter || '').trim();
        return source !== '现代航空电子' && !chapter.startsWith('现代航空电子 - ');
      });

      const existingIds = new Map(questionBank.map((question, index) => [String(question.id), index]));
      const existingKeys = new Map(questionBank.map((question, index) => [
        String(question.chapter || '') + '|||' + String(question.question || ''),
        index
      ]));
      DEFAULT_QUESTIONS.forEach(defaultQuestion => {
        const normalizedDefault = normalizeQuestion(defaultQuestion);
        const key = normalizedDefault.chapter + '|||' + normalizedDefault.question;
        const existingIndex = existingIds.has(normalizedDefault.id)
          ? existingIds.get(normalizedDefault.id)
          : existingKeys.get(key);
        if (existingIndex === undefined) {
          questionBank.push(normalizedDefault);
          existingIds.set(normalizedDefault.id, questionBank.length - 1);
        } else {
          const existing = questionBank[existingIndex];
          questionBank[existingIndex] = {
            ...existing,
            ...normalizedDefault,
            image: existing.image || normalizedDefault.image || ''
          };
          // 同一题干可能对应不同题目 ID；一个旧记录最多匹配一次。
          existingKeys.delete(key);
        }
      });

      questionBank = questionBank.map(normalizeQuestion).filter(question => question.question);
      const validIds = new Set(questionBank.map(question => question.id));
      errorBook = errorBook.filter(entry => validIds.has(entry.questionId));
      bookmarks = bookmarks.filter(id => validIds.has(id));
      questionImages = Object.fromEntries(
        Object.entries(questionImages).filter(([id]) => validIds.has(id))
      );
      settings.dbVersion = 'v14';
      migrated = true;
    }

    // v15：为填空题增加答案顺序规则，并同步内置题库中的可交换标记。
    if ((parseInt(String(settings.dbVersion || '').replace(/\D/g, ''), 10) || 0) < 15) {
      const defaultAnswerOrders = new Map(
        DEFAULT_QUESTIONS.map(question => [String(question.id), normalizeAnswerOrder(question.answerOrder)])
      );
      questionBank = questionBank.map(question => {
        const normalized = normalizeQuestion(question);
        return defaultAnswerOrders.has(normalized.id)
          ? { ...normalized, answerOrder: defaultAnswerOrders.get(normalized.id) }
          : normalized;
      });
      settings.dbVersion = 'v15';
      migrated = true;
    }

    // v16：移除不再使用的示例章节，并停用多选题数据。
    if ((parseInt(String(settings.dbVersion || '').replace(/\D/g, ''), 10) || 0) < 16) {
      questionBank = questionBank
        .map(normalizeQuestion)
        .filter(question => question.question && !RETIRED_CHAPTERS.has(question.chapter) && question.type !== 'multi');
      const validIds = new Set(questionBank.map(question => question.id));
      errorBook = errorBook.filter(entry => validIds.has(entry.questionId));
      bookmarks = bookmarks.filter(id => validIds.has(id));
      questionImages = Object.fromEntries(
        Object.entries(questionImages).filter(([id]) => validIds.has(id))
      );
      settings.dbVersion = 'v16';
      migrated = true;
    }

    if (migrated || isNewUser) {
      console.log(isNewUser ? 'Loaded default embedded question bank.' : 'Migrated old localStorage data to IndexedDB.');
      await persist();
    }
  } catch (err) {
    console.error("Failed to initialize data from IndexedDB:", err);
  }
}

async function persist() {
  await saveData('questionBank', questionBank);
  await saveData('errorBook', errorBook);
  await saveData('bookmarks', bookmarks);
  await saveData('settings', settings);
  await saveData('questionImages', questionImages);
}

/* ================================================================
   导航
   ================================================================ */
let currentPage = 'practice';

function icon(name, className = '') {
  return `<span class="material-symbols-outlined ${className}" aria-hidden="true">${name}</span>`;
}

function showConfirmDialog({ title, message, confirmText = '确认', cancelText = '取消', danger = false }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmDialogTitle">
        <div class="modal-head">
          <div><div class="modal-title" id="confirmDialogTitle">${esc(title)}</div><p class="modal-subtitle">请确认后继续</p></div>
          <button type="button" class="icon-button modal-close" data-confirm="cancel" aria-label="关闭">${icon('close')}</button>
        </div>
        <div class="modal-body"><p class="confirm-message">${esc(message).replace(/\n/g, '<br>')}</p></div>
        <div class="modal-footer">
          <button type="button" class="btn" data-confirm="cancel">${esc(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-destructive' : 'btn-primary'}" data-confirm="ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    const finish = value => { overlay.remove(); resolve(value); };
    overlay.addEventListener('click', event => {
      const action = event.target.closest('[data-confirm]')?.dataset.confirm;
      if (action) finish(action === 'ok');
      else if (event.target === overlay) finish(false);
    });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-confirm="ok"]')?.focus();
  });
}

function syncNavigation() {
  document.querySelectorAll('[data-page]').forEach(item => {
    item.classList.toggle('active', item.dataset.page === currentPage);
    if (item.classList.contains('nav-item')) {
      item.setAttribute('aria-current', item.dataset.page === currentPage ? 'page' : 'false');
    }
  });
}

function closeMobileSidebar() {
  document.body.classList.remove('sidebar-open');
}

function navigateTo(page) {
  currentPage = page;
  closeMobileSidebar();
  renderPage();
}

document.addEventListener('click', function(e) {
  const item = e.target.closest('[data-page]');
  if (!item) return;
  e.preventDefault();
  navigateTo(item.dataset.page);
});

/* ================================================================
   页面渲染入口
   ================================================================ */
function renderPage() {
  const c = $id('container');
  document.body.classList.remove('quiz-active', 'result-active');
  c.className = `container app-container page-${currentPage}`;
  syncNavigation();
  switch (currentPage) {
    case 'practice': renderChapterList(c); break;
    case 'exam-config': renderExamConfig(c); break;
    case 'errors': renderErrorBook(c); break;
    case 'bookmarks': renderBookmarks(c); break;
    case 'search': renderSearch(c); break;
    case 'manage': renderManage(c); break;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ================================================================
   题库管理（导入/导出/清空）
   ================================================================ */
function renderManage(container) {
  const chapters = getChapters();
  const totalSingle = questionBank.filter(q => q.type === 'single').length;
  const totalFill = questionBank.filter(q => q.type === 'fill').length;
  const imageCount = questionBank.filter(q => questionImageSource(q)).length;
  let chaptersHtml = '';
  if (chapters.length === 0) {
    chaptersHtml = '<p style="color:var(--text-sub); font-weight:500;">暂无题目，请先导入题库</p>';
  } else {
    chaptersHtml = chapters.map(ch => {
      const qs = questionBank.filter(q => q.chapter === ch);
      const single = qs.filter(q => q.type === 'single').length;
      const fill = qs.filter(q => q.type === 'fill').length;
      return `<div class="management-chapter-row"><strong>${String(chapters.indexOf(ch) + 1).padStart(2, '0')} · ${esc(ch)}</strong><span>单选 ${single} · 填空 ${fill}</span></div>`;
    }).join('');
  }

  container.innerHTML = `
    <div class="page-heading"><div><h1>题库管理</h1><p>管理本地题目数据、题图与备份。所有数据仅保存在当前设备。</p></div></div>
    <div class="manage-overview">
      <div class="manage-stat-item"><span class="manage-stat-icon">${icon('database')}</span><div class="manage-stat-label">题库总量</div><div class="manage-stat-num">${questionBank.length.toLocaleString()}</div></div>
      <div class="manage-stat-item"><span class="manage-stat-icon">${icon('menu_book')}</span><div class="manage-stat-label">章节数量</div><div class="manage-stat-num">${chapters.length}</div></div>
      <div class="manage-stat-item"><span class="manage-stat-icon">${icon('image')}</span><div class="manage-stat-label">关联题图</div><div class="manage-stat-num">${imageCount}</div></div>
      <div class="manage-stat-item"><span class="manage-stat-icon">${icon('error')}</span><div class="manage-stat-label">待复习错题</div><div class="manage-stat-num">${countValidErrors()}</div></div>
    </div>
    <div class="manage-main-grid">
      <section class="card manage-card">
        <div class="manage-card-title"><h2>${icon('upload_file')} 数据导入</h2><span class="text-button">支持 Excel</span></div>
        <div class="upload-zone-lg" id="uploadZone">
          <div class="upload-zone-lg-icon">${icon('cloud_upload')}</div>
          <div class="upload-zone-lg-title">将 Excel 文件拖到此处，或点击上传</div>
          <div class="upload-zone-lg-sub">支持 .xlsx 文件，单个文件最大 50MB</div>
          <button type="button" class="btn btn-primary">选择文件</button>
          <input type="file" id="fileInput" accept=".xlsx" hidden>
        </div>
        <div id="importMsg" style="margin-top:12px;"></div>
      </section>
      <div class="manage-side-stack">
        <section class="card manage-card image-upload-row">
          <div class="manage-card-title"><h3>${icon('link')} 题图关联</h3></div>
          <p>文件名需与题目 ID 一致，可一次选择多张图片。</p>
          <button class="btn" id="btnChooseImages">${icon('image')} 选择题图</button>
          <input type="file" id="imageInput" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple hidden>
        </section>
        <section class="card manage-card management-actions">
          <div class="manage-card-title"><h3>${icon('download')} 备份与下载</h3></div>
          <button class="btn btn-primary" id="btnExport">${icon('archive')} 导出完整备份</button>
          <button class="btn" id="btnExportErrors">${icon('download')} 导出错题 JSON</button>
        </section>
      </div>
    </div>
    <section class="danger-zone">
      <div><h3>${icon('warning')} 危险操作</h3><p>清理后相关数据将从当前浏览器移除，操作前请先导出备份。</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-destructive" id="btnClearErrors">清空错题集</button><button class="btn btn-destructive" id="btnClear">${icon('delete')} 清空自定义题库</button></div>
    </section>
    <section class="card management-overview-card"><div class="manage-card-title"><h3>${icon('list_alt')} 题库总览</h3><span>单选 ${totalSingle} · 填空 ${totalFill}</span></div>${chaptersHtml}</section>
    <div class="info-alert"><strong>${icon('description')} Excel 模板格式说明</strong><p>必填列：章节、题型、题目、正确答案。单选题支持选项 A-Z；填空题可使用“答案顺序”列标记各空可交换；图片列可使用题图、图片、图片路径或题图文件。</p></div>`;

  // 上传区域点击
  $id('uploadZone').addEventListener('click', () => $id('fileInput').click());
  $id('fileInput').addEventListener('change', handleImport);
  $id('uploadZone').addEventListener('dragover', event => {
    event.preventDefault();
    event.currentTarget.classList.add('dragging');
  });
  $id('uploadZone').addEventListener('dragleave', event => event.currentTarget.classList.remove('dragging'));
  $id('uploadZone').addEventListener('drop', event => {
    event.preventDefault();
    event.currentTarget.classList.remove('dragging');
    const [file] = event.dataTransfer.files;
    if (file) handleImport({ target: { files: [file] } });
  });
  $id('btnChooseImages').addEventListener('click', () => $id('imageInput').click());
  $id('imageInput').addEventListener('change', handleImageImport);
  $id('btnExport').addEventListener('click', () => downloadJSON('quiz-app-backup.json', {
      version: 16,
    exportedAt: new Date().toISOString(),
    questionBank,
    errorBook,
    bookmarks,
    settings,
    questionImages
  }));
  $id('btnExportErrors').addEventListener('click', () => {
    const data = errorBook.map(e => {
      const q = questionBank.find(q => q.id === e.questionId);
      return { ...e, question: q ? q.question : '(题目已删除)' };
    });
    downloadJSON('errorBook.json', data);
  });
  $id('btnClear').addEventListener('click', async () => {
    const hasDefaults = DEFAULT_QUESTIONS.length > 0;
    const confirmMsg = hasDefaults
      ? '确定要清空您导入的自定义题库数据吗？内置默认题库将会保留。'
      : '确定要清空题库中所有的题目数据吗？此操作不可恢复。';
    if (await showConfirmDialog({ title: '清空题库？', message: confirmMsg, confirmText: '清空题库', danger: true })) {
      questionBank = DEFAULT_QUESTIONS.slice();
      errorBook = errorBook.filter(e => DEFAULT_QUESTIONS.some(dq => dq.id === e.questionId));
      bookmarks = bookmarks.filter(id => DEFAULT_QUESTIONS.some(dq => dq.id === id));
      questionImages = Object.fromEntries(
        Object.entries(questionImages).filter(([id]) => DEFAULT_QUESTIONS.some(dq => dq.id === id))
      );
      await persist();
      renderPage();
    }
  });
  $id('btnClearErrors').addEventListener('click', async () => {
    if (await showConfirmDialog({ title: '清空错题集？', message: '所有错题记录和错误次数将被删除，此操作无法撤销。', confirmText: '清空错题集', danger: true })) {
      errorBook = [];
      await persist();
      renderPage();
    }
  });
}

/* ================================================================
   Excel 导入
   ================================================================ */
function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(evt) {
    try {
      showImportMsg('info', '正在解析并保存数据，请稍候...');
      // 允许 UI 渲染提示消息
      await new Promise(resolve => setTimeout(resolve, 50));

      const wb = XLSX.read(evt.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      if (rows.length < 2) {
        showImportMsg('error', 'Excel 文件为空或格式不正确');
        return;
      }

      const headerRowIndex = rows.findIndex(row => {
        const cells = row.map(value => String(value || '').trim());
        return cells.includes('章节') && cells.includes('题型') && cells.includes('题目') && cells.includes('正确答案');
      });
      if (headerRowIndex < 0) {
        showImportMsg('error', '未找到包含“章节、题型、题目、正确答案”的表头行');
        return;
      }

      const headers = rows[headerRowIndex].map(h => String(h).trim());
      const idIdx = headers.findIndex(h => h === '题目ID');
      const sourceIdx = headers.findIndex(h => h === '资料名称');
      const chapterIdx = headers.findIndex(h => h === '章节');
      const topicIdx = headers.findIndex(h => h === '考点');
      const pageIdx = headers.findIndex(h => h === '原书页码');
      const localNumberIdx = headers.findIndex(h => ['本章题号', '小节题号'].includes(h));
      const globalNumberIdx = headers.findIndex(h => h === '全书题号');
      const typeIdx = headers.findIndex(h => h === '题型');
      const questionIdx = headers.findIndex(h => h === '题目');
      const answerIdx = headers.findIndex(h => h === '正确答案');
      const answerOrderIdx = headers.findIndex(h => ['答案顺序', '填空顺序'].includes(h));
      const explainIdx = headers.findIndex(h => h === '解析');
      const imageIdx = headers.findIndex(h => ['题图', '图片', '图片路径', '题图文件'].includes(h));

      // 查找所有选项列（匹配"选项A"到"选项Z"）
      const optionIndices = [];
      headers.forEach((h, i) => {
        const m = h.match(/^选项([A-Z])$/);
        if (m) optionIndices.push(i);
      });

      if (chapterIdx === -1 || typeIdx === -1 || questionIdx === -1 || answerIdx === -1) {
        showImportMsg('error', '缺少必填列：章节、题型、题目、正确答案');
        return;
      }
      const fileName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      const fallbackSource = fileName.replace(/[（(].*$/, '').replace(/-第\d+.*$/, '').trim();
      let newCount = 0, updateCount = 0, skipCount = 0, invalidCount = 0, unsupportedCount = 0, retiredCount = 0;
      const existingKeys = new Map(questionBank.map((q, index) => [q.chapter + '|||' + q.question, index]));
      const existingIds = new Map(questionBank.map((q, index) => [String(q.id), index]));

      for (let r = headerRowIndex + 1; r < rows.length; r++) {
        const row = rows[r];
        const chapter = String(row[chapterIdx] || '').trim();
        const typeStr = String(row[typeIdx] || '').trim();
        const question = String(row[questionIdx] || '').trim();

        if (!chapter || !typeStr || !question) continue;

        const sourceName = sourceIdx >= 0 && String(row[sourceIdx] || '').trim()
          ? String(row[sourceIdx]).trim()
          : fallbackSource;
        const finalChapter = chapter.startsWith(sourceName + ' - ') ? chapter : `${sourceName} - ${chapter}`;
        if (RETIRED_CHAPTERS.has(chapter) || RETIRED_CHAPTERS.has(finalChapter)) {
          retiredCount++;
          continue;
        }
        const providedId = idIdx >= 0 ? String(row[idIdx] || '').trim() : '';

        const key = finalChapter + '|||' + question;
        const existingIndex = providedId
          ? existingIds.get(providedId)
          : existingKeys.get(key);

        let type = normalizeQuestionType(typeStr);
        if (type === 'multi') {
          unsupportedCount++;
          continue;
        }
        const options = [];
        const optionMap = {}; // letter -> index
        if (type !== 'fill') {
          for (const oi of optionIndices) {
            const val = String(row[oi] || '').trim();
            if (val) {
              const letter = headers[oi].replace('选项', '');
              optionMap[letter] = options.length;
              options.push(val);
            }
          }
        }

        const answerRaw = String(row[answerIdx] || '').trim();
        if (!answerRaw) { invalidCount++; continue; }
        let answers = [];
        if (type === 'fill') {
          answers = parseFillAnswers(answerRaw, { question });
        } else {
          if (options.length < 2) {
            // 少数原表中的“题图分问”被标为选择题，但并没有可选项。
            // 将其作为多空文本题保留，避免静默丢题。
            type = 'fill';
            answers = answerRaw.split(/[,，、;；]+/).map(value => value.trim()).filter(Boolean);
          } else {
            answers = answerRaw.toUpperCase().split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean);
            answers = answers.filter(answer => Object.prototype.hasOwnProperty.call(optionMap, answer));
          }
        }
        if (!answers.length) { invalidCount++; continue; }

        const qObj = normalizeQuestion({
          id: providedId || (existingIndex !== undefined ? questionBank[existingIndex].id : genId()),
          source: sourceName,
          chapter: finalChapter,
          type,
          originalType: typeStr,
          question,
          options,
          answer: answers,
          answerOrder: answerOrderIdx >= 0 ? String(row[answerOrderIdx] || '').trim() : 'fixed',
          explanation: explainIdx >= 0 ? String(row[explainIdx] || '').trim() : '',
          topic: topicIdx >= 0 ? String(row[topicIdx] || '').trim() : '',
          page: pageIdx >= 0 ? String(row[pageIdx] || '').trim() : '',
          localNumber: localNumberIdx >= 0 ? String(row[localNumberIdx] || '').trim() : '',
          globalNumber: globalNumberIdx >= 0 ? String(row[globalNumberIdx] || '').trim() : '',
          image: imageIdx >= 0 ? String(row[imageIdx] || '').trim() : ''
        });

        if (existingIndex !== undefined) {
          const existingImage = questionBank[existingIndex].image;
          questionBank[existingIndex] = { ...qObj, image: qObj.image || existingImage || '' };
          updateCount++;
        } else if (!providedId && existingKeys.has(key)) {
          skipCount++;
        } else {
          const nextIndex = questionBank.length;
          questionBank.push(qObj);
          existingKeys.set(key, nextIndex);
          existingIds.set(qObj.id, nextIndex);
          newCount++;
        }
      }

      await persist();
      renderPage();
      const unsupportedText = unsupportedCount ? `，已跳过多选题 ${unsupportedCount} 题` : '';
      const retiredText = retiredCount ? `，已跳过停用章节 ${retiredCount} 题` : '';
      showImportMsg('success', `导入完成：新增 ${newCount} 题，更新 ${updateCount} 题，跳过重复 ${skipCount} 题，格式无效 ${invalidCount} 题${unsupportedText}${retiredText}`);
    } catch (err) {
      showImportMsg('error', '解析失败：' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function handleImageImport(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;

  const questionsById = new Map(questionBank.map(question => [question.id.toLowerCase(), question]));
  let matched = 0;
  const unmatched = [];
  for (const file of files) {
    const id = file.name.replace(/\.[^.]+$/, '').toLowerCase();
    const question = questionsById.get(id);
    if (!question) {
      unmatched.push(file.name);
      continue;
    }
    questionImages[question.id] = await readFileAsDataURL(file);
    matched++;
  }

  await persist();
  const suffix = unmatched.length ? `；${unmatched.length} 张未找到同名题目 ID` : '';
  renderPage();
  showImportMsg(matched ? 'success' : 'error', `已关联 ${matched} 张题图${suffix}`);
}

function showImportMsg(type, text) {
  const el = $id('importMsg');
  if (el) el.innerHTML = `<div class="msg msg-${type}">${esc(text)}</div>`;
}

/* ================================================================
   章节列表（章节练习入口）
   ================================================================ */
function renderChapterList(container) {
  const chapters = getChapters();
  if (chapters.length === 0) {
    container.innerHTML = `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">📚</div>
          <div class="empty-state-title">暂无题库内容</div>
          <div class="empty-state-desc">还没有题目，请先到「题库管理」导入 Excel 格式的题库文件。</div>
          <button class="btn btn-primary" onclick="currentPage='manage'; renderPage();" style="min-width:160px; padding:12px 24px;">去导入题库</button>
        </div>
      </div>`;
    return;
  }

  // 对章节进行二级分组
  const groups = {};
  const groupOrder = [];
  chapters.forEach(ch => {
    const parts = ch.split(' - ');
    const parent = parts[0];
    const sub = parts.length > 1 ? parts.slice(1).join(' - ') : '';
    if (!groups[parent]) {
      groups[parent] = [];
      groupOrder.push(parent);
    }
    groups[parent].push({ fullName: ch, subName: sub || ch });
  });

  const groupsHtml = groupOrder.map((parent, idx) => {
    const subItems = groups[parent];
    let totalQuestions = 0;
    const subItemsHtml = subItems.map(item => {
      const qs = questionBank.filter(q => q.chapter === item.fullName);
      const single = qs.filter(q => q.type === 'single').length;
      const fill = qs.filter(q => q.type === 'fill').length;
      totalQuestions += qs.length;
      return `<div class="chapter-card" data-chapter="${escAttr(item.fullName)}">
        <div class="chapter-card-main">
          <div class="chapter-card-num">${String(subItems.indexOf(item) + 1).padStart(2, '0')}</div>
          <div class="chapter-card-copy">
            <span class="chapter-card-name">${esc(item.subName)}</span>
            <span class="chapter-card-desc">按题目范围练习本章内容，共 ${qs.length} 道题</span>
          </div>
        </div>
        <span class="chapter-card-badge">
          <span class="chapter-count"><strong>${single}</strong><span>单选题</span></span>
          <span class="chapter-count"><strong>${fill}</strong><span>填空题</span></span>
        </span>
        <button type="button" class="btn btn-primary chapter-start">开始练习 ${icon('arrow_forward')}</button>
      </div>`;
    }).join('');

    // 默认展示全部展开状态（添加 .expanded 类）
    return `<div class="chapter-group expanded" data-group-index="${idx}">
      <div class="chapter-group-header">
        <span class="group-title">${icon('menu_book')} ${esc(parent)}</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="chapter-badge" style="font-weight:600; background:var(--primary-light); color:var(--primary); padding:3px 8px; border-radius:12px; font-size:12px;">共 ${totalQuestions} 题</span>
          <span class="group-arrow material-symbols-outlined">expand_less</span>
        </div>
      </div>
      <div class="chapter-group-content">
        ${subItemsHtml}
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="page-heading">
      <div>
        <h1>章节练习</h1>
        <p>选择章节和题目范围，选择题与填空题会在同一轮练习中统一判分。</p>
      </div>
      <span class="page-heading-count">${questionBank.length} 题</span>
    </div>
    <div class="overview-grid" aria-label="学习概览">
      <section class="overview-card">
        ${icon('database')}
        <div class="overview-label">题库总量</div>
        <div class="overview-value">${questionBank.length.toLocaleString()}</div>
        <div class="overview-note">${icon('check_circle')} 已载入本地题库</div>
      </section>
      <section class="overview-card">
        ${icon('error')}
        <div class="overview-label">待复习错题</div>
        <div class="overview-value">${countValidErrors()}</div>
        <div class="overview-progress"><span style="width:${questionBank.length ? Math.min(100, countValidErrors() / questionBank.length * 100) : 0}%"></span></div>
      </section>
      <section class="overview-card">
        ${icon('menu_book')}
        <div class="overview-label">已覆盖章节</div>
        <div class="overview-value">${chapters.length}</div>
        <div class="overview-note muted">${bookmarks.length} 道重点收藏</div>
      </section>
    </div>
    <div class="chapter-list" id="chapterList">
      ${groupsHtml}
    </div>
  `;

  $id('chapterList').addEventListener('click', function(e) {
    // 1. 判断是否点击了子章节项
    const item = e.target.closest('.chapter-card');
    if (item) {
      const chapter = item.dataset.chapter;
      const questions = questionBank.filter(q => q.chapter === chapter);
      showPracticeConfigModal(questions, chapter);
      return;
    }

    // 2. 判断是否点击了一级分类头部，实现收起/展开折叠栏
    const header = e.target.closest('.chapter-group-header');
    if (header) {
      const group = header.closest('.chapter-group');
      if (group) {
        group.classList.toggle('expanded');
      }
    }
  });
}

function showPracticeConfigModal(questions, chapter) {
  const total = questions.length;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'practiceConfigModal';

  // 动态生成分段快捷选择按钮（每50题一组）
  let quickButtonsHtml = '';
  const segmentSize = 50;
  if (total <= segmentSize) {
    quickButtonsHtml += `<button class="btn btn-sm btn-range-quick" data-start="1" data-end="${total}" style="padding: 4px 10px; font-size: 12px; border-radius: 8px;">全部</button>`;
  } else {
    let i = 1;
    while (i <= total) {
      const start = i;
      const end = Math.min(i + segmentSize - 1, total);
      quickButtonsHtml += `<button class="btn btn-sm btn-range-quick" data-start="${start}" data-end="${end}" style="padding: 4px 10px; font-size: 12px; border-radius: 8px; margin-right: 6px; margin-bottom: 6px;">${start}-${end}题</button>`;
      i += segmentSize;
    }
    quickButtonsHtml += `<button class="btn btn-sm btn-range-quick" data-start="1" data-end="${total}" style="padding: 4px 10px; font-size: 12px; border-radius: 8px; margin-right: 6px; margin-bottom: 6px;">全部</button>`;
  }

  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="practiceConfigTitle">
      <div class="modal-head">
        <div><div class="modal-title" id="practiceConfigTitle">练习配置</div><p class="modal-subtitle">${esc(chapter)}</p></div>
        <button type="button" class="icon-button modal-close" id="btnPracticeClose" aria-label="关闭">${icon('close')}</button>
      </div>
      <div class="modal-body">
        <div class="modal-info">${icon('info')}<div><strong>本章共计 ${total} 题</strong><br>设置本次练习的连续题号范围。</div></div>
        <label class="range-label" for="practiceStartInput">选择题目范围</label>
        <div class="range-fields">
          <div class="range-input-wrap"><input type="number" class="input" id="practiceStartInput" value="1" min="1" max="${total}"><span>起始</span></div>
          <span>—</span>
          <div class="range-input-wrap"><input type="number" class="input" id="practiceEndInput" value="${total}" min="1" max="${total}"><span>结束</span></div>
        </div>
        <div class="range-summary">本次将练习 <strong id="rangeCountText">${total}</strong> 道题</div>
        <span class="range-label">快捷范围</span>
        <div class="quick-range-list">${quickButtonsHtml}</div>
        <div class="range-error" id="rangeError" role="alert"></div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="btnPracticeCancel">取消</button>
        <button class="btn btn-primary" id="btnPracticeStart">${icon('play_arrow')} 开始练习</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const startInput = overlay.querySelector('#practiceStartInput');
  const endInput = overlay.querySelector('#practiceEndInput');
  const countText = overlay.querySelector('#rangeCountText');
  const rangeError = overlay.querySelector('#rangeError');
  const startButton = overlay.querySelector('#btnPracticeStart');

  function updateRangeCount() {
    const start = parseInt(startInput.value);
    const end = parseInt(endInput.value);
    if (!isNaN(start) && !isNaN(end) && start >= 1 && end >= start && end <= total) {
      countText.textContent = end - start + 1;
      rangeError.textContent = '';
      startButton.disabled = false;
    } else {
      countText.textContent = '--';
      rangeError.textContent = `请输入 1 至 ${total} 之间的有效范围，且结束题号不能小于起始题号。`;
      startButton.disabled = true;
    }
  }

  startInput.addEventListener('input', updateRangeCount);
  endInput.addEventListener('input', updateRangeCount);

  const closeModal = () => overlay.remove();
  overlay.querySelector('#btnPracticeCancel').addEventListener('click', closeModal);
  overlay.querySelector('#btnPracticeClose').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  // 快捷选择事件绑定
  overlay.querySelectorAll('.btn-range-quick').forEach(btn => {
    btn.addEventListener('click', function() {
      startInput.value = this.dataset.start;
      endInput.value = this.dataset.end;
      updateRangeCount();
    });
  });

  overlay.querySelector('#btnPracticeStart').addEventListener('click', () => {
    const start = parseInt(startInput.value);
    const end = parseInt(endInput.value);
    if (startButton.disabled || isNaN(start) || isNaN(end)) return;
    overlay.remove();
    // 按顺序从题库中把这部分题切出来（1-indexed 转为 0-indexed slice）
    const selectedQuestions = questions.slice(start - 1, end);
    // 题目顺序与选项顺序仍然进行打乱
    startQuiz(selectedQuestions, chapter);
  });
}

/* ================================================================
   刷题模式（全部答完统一判分）
   ================================================================ */
let quizState = null;

function startQuiz(questions, chapter, limit = null) {
  const shuffledQuestions = shuffle(questions.map(normalizeQuestion));
  const selectedQuestions = limit ? shuffledQuestions.slice(0, limit) : shuffledQuestions;
  const prepared = selectedQuestions.map(q => {
    if (q.type === 'fill') {
      return { ...q, displayOptions: [], letterMap: {} };
    }
    const mapped = q.options.map((text, i) => ({ text, originalLetter: String.fromCharCode(65 + i) }));
    const shuffled = shuffle(mapped);
    const letterMap = {}; // 显示字母 → 原始字母
    const displayOptions = shuffled.map((item, i) => {
      const displayLetter = String.fromCharCode(65 + i);
      letterMap[displayLetter] = item.originalLetter;
      return { text: item.text, letter: displayLetter };
    });
    return { ...q, displayOptions, letterMap };
  });

  quizState = {
    questions: prepared,
    answers: new Array(prepared.length).fill(null),
    currentIndex: 0,
    chapter: chapter,
    mode: 'practice',
    submitted: false,
    navCollapsed: false,
    flagged: []
  };
  renderQuizCard();
}

function renderQuizCard() {
  const total = quizState.questions.length;
  const idx = quizState.currentIndex;
  const q = quizState.questions[idx];
  const isMulti = q.type === 'multi';
  const isFill = q.type === 'fill';
  const fillBlankCount = isFill ? countFillBlanks(q) : 0;
  const isFlexibleFillOrder = isFill && fillBlankCount > 1 && q.answerOrder === 'any';
  const typeMeta = questionTypeMeta(q.type);
  const gridClass = q.displayOptions.length > 4 ? 'single-col' : '';
  const selected = quizState.answers[idx] || [];
  const answeredCount = quizState.answers.filter(hasUserAnswer).length;

  const isFlagged = quizState.flagged.includes(q.id);

  // 题目导航按钮
  let navGridHtml = `<div class="quiz-nav-sidebar ${quizState.navCollapsed ? 'collapsed' : ''}" id="quizNavSidebar">`;
  for (let i = 0; i < total; i++) {
    const qId = quizState.questions[i].id;
    const isQFlagged = quizState.flagged.includes(qId);
    const cls = [
      i === idx ? 'current' : '',
      hasUserAnswer(quizState.answers[i]) ? 'answered' : '',
      isQFlagged ? 'flagged' : ''
    ].filter(Boolean).join(' ');
    navGridHtml += `<button type="button" class="quiz-nav-dot ${cls}" data-idx="${i}" aria-label="第 ${i + 1} 题">${i + 1}</button>`;
  }
  navGridHtml += '</div>';
  const navHtml = `
    <aside class="quiz-nav-panel">
      <h3>题目概览 <button type="button" class="text-button" id="btnToggleNav">${quizState.navCollapsed ? '展开' : '收起'}</button></h3>
      ${navGridHtml}
      <div class="quiz-legend">
        <span class="answered"><i></i>已作答</span><span class="current"><i></i>当前题</span>
        <span class="flagged"><i></i>已标记</span><span><i></i>未作答</span>
      </div>
    </aside>`;

  document.body.classList.remove('result-active');
  document.body.classList.add('quiz-active');
  const container = $id('container');
  container.className = 'container app-container quiz-container';
  container.innerHTML = `
    <div class="quiz-page">
      <div class="quiz-workbar">
        <button type="button" class="quiz-exit" id="btnExitQuiz">${icon('arrow_back')} 退出</button>
        <span class="quiz-session-title">${esc(quizState.chapter)}</span>
        <div class="quiz-session-progress"><span>进度：${idx + 1}/${total}</span><div class="quiz-progress-track"><span style="width:${(idx + 1) / total * 100}%"></span></div></div>
      </div>
      <div class="quiz-layout quiz-layout-${q.type}">
        ${navHtml}
        <main class="quiz-main">
          <div class="card quiz-card">
            <div class="quiz-header">
              <div><span class="tag ${typeMeta.tagClass}">${typeMeta.label}</span> <span class="quiz-progress">第 ${idx + 1} 题 / 共 ${total} 题 · 已答 ${answeredCount} 题</span></div>
              <div class="quiz-actions">
                <button type="button" class="quiz-icon-action ${isFlagged ? 'active' : ''}" id="btnToggleFlag" title="${isFlagged ? '取消标记' : '标记此题'}" aria-label="${isFlagged ? '取消标记' : '标记此题'}">${icon('flag')}</button>
                <button type="button" class="quiz-icon-action quiz-bookmark-btn ${bookmarks.includes(q.id) ? 'bookmarked' : ''}" id="btnToggleBookmark" title="${bookmarks.includes(q.id) ? '取消收藏' : '收藏此题'}" aria-label="${bookmarks.includes(q.id) ? '取消收藏' : '收藏此题'}">${icon(bookmarks.includes(q.id) ? 'star' : 'star_outline')}</button>
              </div>
            </div>
            <div class="question-row"><div class="question-text">${esc(q.question)}</div></div>
            ${renderQuestionImage(q)}
            ${isFill ? `
              <div class="fill-answer-panel" id="fillAnswerPanel">
                <div class="fill-answer-heading"><div class="fill-answer-label">填写答案</div>${isFlexibleFillOrder ? '<span class="fill-order-badge">各空顺序可交换</span>' : ''}</div>
                ${Array.from({ length: fillBlankCount }, (_, inputIndex) => `
                  <label class="fill-answer-field"><span>${fillBlankCount > 1 ? `第 ${inputIndex + 1} 空` : '答案'}</span><input class="input fill-answer-input" data-fill-index="${inputIndex}" value="${escAttr(selected[inputIndex] || '')}" autocomplete="off" placeholder="输入答案..."></label>
                `).join('')}
                <p class="fill-answer-help">${isFlexibleFillOrder ? '本题各空答案可交换顺序；自动判分会忽略空格、常见标点和大小写。' : '自动判分会忽略空格、常见标点和大小写；多个空请按题目顺序填写。'}</p>
              </div>` : `
              <div class="options-grid ${gridClass}" id="optionsGrid">
                ${q.displayOptions.map(opt => `<button type="button" class="option-btn ${selected.includes(opt.letter) ? 'selected' : ''}" data-letter="${opt.letter}"><span class="option-letter">${opt.letter}</span><span><strong>${opt.letter}.</strong>&nbsp; ${esc(opt.text)}</span></button>`).join('')}
              </div>`}
          </div>
          ${isFill ? `<div class="grading-note">${icon('info')}<div><strong>评分规则</strong><br>${isFlexibleFillOrder ? '各空答案允许互换。' : '请按空位顺序作答。'}系统会忽略空格、常见标点和大小写。</div></div>` : ''}
          <div class="quiz-footer">
            <button class="btn" id="btnPrev" ${idx === 0 ? 'disabled' : ''}>${icon('arrow_back')} 上一题</button>
            <span class="quiz-footer-hint">${isFill ? '填写完成后可继续下一题' : (isMulti ? '可选择多个答案，再进入下一题' : '选择答案后将自动进入下一题')}</span>
            ${idx < total - 1 ? `<button class="btn btn-primary" id="btnNext">下一题 ${icon('arrow_forward')}</button>` : `<button class="btn btn-primary" id="btnSubmit">${icon('check')} 交卷</button>`}
          </div>
        </main>
      </div>
    </div>`;

  if (isFill) {
    document.querySelectorAll('.fill-answer-input').forEach(input => {
      input.addEventListener('input', () => {
        const answers = [...document.querySelectorAll('.fill-answer-input')].map(field => field.value);
        quizState.answers[idx] = hasUserAnswer(answers) ? answers : null;
      });
    });
    document.querySelector('.fill-answer-input')?.focus();
  } else {
    const grid = $id('optionsGrid');
    grid.addEventListener('click', function(e) {
      const btn = e.target.closest('.option-btn');
      if (!btn) return;
      const letter = btn.dataset.letter;

      if (isMulti) {
        let answers = quizState.answers[idx] || [];
        answers = answers.includes(letter)
          ? answers.filter(value => value !== letter)
          : [...answers, letter];
        quizState.answers[idx] = answers.length ? answers : null;
        btn.classList.toggle('selected');
      } else {
        quizState.answers[idx] = [letter];
        if (idx < quizState.questions.length - 1) quizState.currentIndex++;
        renderQuizCard();
      }
    });
  }

  // 题目导航点击
  document.querySelectorAll('.quiz-nav-dot').forEach(dot => {
    dot.addEventListener('click', function() {
      quizState.currentIndex = parseInt(this.dataset.idx);
      renderQuizCard();
    });
  });

  $id('btnToggleNav').addEventListener('click', () => {
    const nav = $id('quizNavSidebar');
    const btn = $id('btnToggleNav');
    if (nav && btn) {
      const isCollapsed = nav.classList.toggle('collapsed');
      quizState.navCollapsed = isCollapsed;
      btn.textContent = isCollapsed ? '展开' : '收起';
    }
  });

  $id('btnExitQuiz').addEventListener('click', async () => {
    const answered = quizState.answers.filter(hasUserAnswer).length;
    const shouldExit = answered === 0 || await showConfirmDialog({
      title: '退出本次练习？',
      message: `当前已作答 ${answered} 题，退出后本轮答案不会保留。`,
      confirmText: '退出练习',
      danger: true
    });
    if (shouldExit) navigateTo('practice');
  });

  $id('btnToggleFlag').addEventListener('click', () => {
    const qId = q.id;
    const idxInFlagged = quizState.flagged.indexOf(qId);
    if (idxInFlagged > -1) {
      quizState.flagged.splice(idxInFlagged, 1);
    } else {
      quizState.flagged.push(qId);
    }
    renderQuizCard();
  });


  $id('btnToggleBookmark').addEventListener('click', async () => {
    const qId = q.id;
    const bi = bookmarks.indexOf(qId);
    if (bi >= 0) bookmarks.splice(bi, 1);
    else bookmarks.push(qId);
    await persist();
    renderQuizCard();
  });
  $id('btnPrev').addEventListener('click', () => { quizState.currentIndex--; renderQuizCard(); });
  if (idx < total - 1) {
    $id('btnNext').addEventListener('click', () => { quizState.currentIndex++; renderQuizCard(); });
  } else {
    $id('btnSubmit').addEventListener('click', async () => {
      const unanswered = quizState.answers.filter(answer => !hasUserAnswer(answer)).length;
      const flagged = quizState.flagged.length;
      let msg = `本次共 ${total} 题，已作答 ${total - unanswered} 题。`;
      if (unanswered > 0) msg += `\n还有 ${unanswered} 题未作答，交卷后将计为错误。`;
      if (flagged > 0) msg += `\n另有 ${flagged} 题被标记。`;
      if (await showConfirmDialog({ title: '确认交卷？', message: msg, confirmText: '确认交卷' })) submitQuiz();
    });
  }
}

function submitQuiz() {
  quizState.submitted = true;
  let correct = 0, wrong = 0;
  const results = quizState.questions.map((q, i) => {
    const submittedAnswer = quizState.answers[i] || [];
    const userDisplayLetters = q.type === 'fill' ? [] : submittedAnswer;
    const userAnswer = q.type === 'fill'
      ? submittedAnswer.map(value => String(value || '').trim())
      : userDisplayLetters.map(letter => q.letterMap ? q.letterMap[letter] : letter);
    const isCorrect = q.type === 'fill'
      ? isFillAnswerCorrect(userAnswer, q.answer, q.answerOrder)
      : JSON.stringify([...userAnswer].sort()) === JSON.stringify([...q.answer].sort());
    if (isCorrect) { correct++; } else { wrong++; addToErrorBook(q.id); }
    return { ...q, userAnswer, isCorrect, userDisplayLetters };
  });

  quizState.correct = correct;
  quizState.wrong = wrong;
  quizState.results = results;

  showQuizResult(results);
}

function showQuizResult(results) {
  const total = results.length;
  const correct = quizState.correct;
  const wrong = quizState.wrong;
  const pct = total > 0 ? Math.round(correct / total * 100) : 0;

  let perQuestionScore = 0;
  let earnedScore = 0;
  let displayEarned = 0;
  let displayPerQuestion = 0;

  const isExam = quizState.chapter === '模拟考试';

  if (isExam) {
    perQuestionScore = total > 0 ? 100 / total : 0;
    results.forEach(r => {
      if (r.isCorrect) {
        earnedScore += perQuestionScore;
      }
    });

    displayEarned = Math.round(earnedScore * 10) / 10;
    displayPerQuestion = Math.round(perQuestionScore * 100) / 100;
  }

  const wrongResults = results.filter(r => !r.isCorrect);
  let detailHtml = '';
  if (wrongResults.length === 0) {
    detailHtml = '<div style="text-align:center; padding:32px 0; color:var(--correct); font-weight:600; font-size:15px;">🎉 太棒了！本轮练习全部答对，没有错题！</div>';
  } else {
    detailHtml = wrongResults.map(r => {
      const idx = results.indexOf(r);
      const typeMeta = questionTypeMeta(r.type);
      const reverseMap = {};
      if (r.letterMap) {
        for (const [dl, ol] of Object.entries(r.letterMap)) { reverseMap[ol] = dl; }
      }
      const correctDisplay = r.type === 'fill'
        ? formatQuestionAnswer(r)
        : r.answer.map(a => reverseMap[a] || a).sort().join(', ');
      const userDisplay = r.type === 'fill'
        ? (r.userAnswer.filter(Boolean).join(' / ') || '未作答')
        : ((r.userDisplayLetters && r.userDisplayLetters.length > 0)
          ? [...r.userDisplayLetters].sort().join(', ') : '未作答');
      const statusIcon = icon('cancel');
      const statusColor = 'var(--wrong)';
      const itemClass = 'wrong-item';

      const optionsDetail = r.type === 'fill' ? '' : r.displayOptions.map(opt => {
          const isCorrectOpt = r.answer.includes(r.letterMap ? r.letterMap[opt.letter] || opt.letter : opt.letter);
          const isUserPick = (r.userDisplayLetters || []).includes(opt.letter);
          let cls = '';
          if (isCorrectOpt && isUserPick) cls = 'correct';
          else if (isUserPick && !isCorrectOpt) cls = 'wrong';
          else if (isCorrectOpt) cls = 'correct';
          return `<span class="result-opt ${cls}">${opt.letter}. ${esc(opt.text)}</span>`;
        }).join(' ');

      const displayQScore = Math.round(perQuestionScore * 100) / 100;
      const scoreHint = isExam ? ` <span style="font-size:11px; color:var(--text-sub); font-weight:normal;">(分值: ${displayQScore}分)</span>` : '';

      const isQFlagged = quizState.flagged.includes(r.id);
      const flagBadge = isQFlagged ? ' <span style="font-size:12px; color:var(--warning);" title="答题中标记过">🚩</span>' : '';

      return `
        <div class="result-item collapsed ${itemClass}" data-idx="${idx}">
          <div class="result-summary" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span style="flex:1; min-width:0;">
              <strong>${statusIcon} ${idx + 1}.</strong>
              <span class="tag ${typeMeta.tagClass}" style="margin:0 4px;">${typeMeta.shortLabel}</span>
              <span style="color:var(--text-main); font-weight:500;">${esc(r.question)}</span>${flagBadge}${scoreHint}
            </span>
            <span style="flex-shrink:0; font-size:13px; font-weight:600; color:${statusColor};">✗ ${userDisplay}</span>
            <span class="result-arrow material-symbols-outlined">expand_more</span>
          </div>
          <div class="result-detail" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border-color); font-size:13px; color:var(--text-sub);">
            ${renderQuestionImage(r, 'result-question-image')}
            ${optionsDetail ? `<div style="margin-bottom:8px;"><strong>选项：</strong>${optionsDetail}</div>` : ''}
            <div class="answer-comparison">
              <div class="answer-panel user"><label>你的答案</label><strong>${userDisplay}</strong></div>
              <div class="answer-panel correct"><label>${r.type === 'fill' ? '参考答案' : '正确答案'}</label><strong>${esc(correctDisplay)}</strong></div>
            </div>
            ${r.explanation ? `<div class="explanation" style="margin-top:8px"><strong>解析：</strong>${esc(r.explanation)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  document.body.classList.remove('quiz-active');
  document.body.classList.add('result-active');
  const container = $id('container');
  container.className = 'container app-container result-container';
  const attempted = results.filter(r => hasUserAnswer(r.userAnswer)).length;
  container.innerHTML = `
    <section class="result-hero">
      <h1>答题结果</h1>
      <p>${esc(quizState.chapter)} · ${isExam ? `每题 ${displayPerQuestion} 分` : '本轮练习已完成'}</p>
      <div class="result-metrics">
        <div class="result-metric"><span>正确率</span><strong>${pct}<small>%</small></strong><div class="result-meter"><i style="width:${pct}%"></i></div></div>
        <div class="result-metric"><span>${isExam ? '考试得分' : '正确题数'}</span><strong>${isExam ? displayEarned : correct}<small> / ${isExam ? 100 : total}</small></strong></div>
        <div class="result-metric"><span>已作答题目</span><strong>${attempted}<small> / ${total}</small></strong></div>
      </div>
      <div class="result-actions"><button class="btn" id="btnBack">返回列表</button><button class="btn btn-primary" id="btnRetry">再次练习</button></div>
    </section>
    <section>
      <h2 class="result-section-title">${icon(wrong ? 'error' : 'check_circle')} ${wrong ? `错题回顾（${wrong}）` : '本轮全部答对'}</h2>
      <div class="result-list">${detailHtml}</div>
    </section>`;
  $id('btnBack').addEventListener('click', () => navigateTo('practice'));
  $id('btnRetry').addEventListener('click', () => startQuiz(quizState.questions, quizState.chapter));
}

function renderReferenceOptions(question) {
  if (question.type === 'fill') return '';
  return question.options.map((option, index) => {
    const letter = String.fromCharCode(65 + index);
    const isCorrect = question.answer.includes(letter);
    return `<span class="result-opt ${isCorrect ? 'correct' : ''}">${letter}. ${esc(option)}</span>`;
  }).join(' ');
}

function renderReferenceDetail(question) {
  const options = renderReferenceOptions(question);
  return `
    ${renderQuestionImage(question, 'result-question-image')}
    ${options ? `<div style="margin-bottom:8px;"><strong>选项：</strong>${options}</div>` : ''}
    ${question.explanation ? `<div class="explanation" style="margin-top:8px"><strong>解析：</strong>${esc(question.explanation)}</div>` : ''}
  `;
}

/* ================================================================
   错题集
   ================================================================ */
function renderErrorBook(container) {
  // 清理无关联题目的无效错题记录
  const before = errorBook.length;
  errorBook = errorBook.filter(e => questionBank.some(q => q.id === e.questionId));
  if (errorBook.length !== before) persist();

  if (errorBook.length === 0) {
    container.innerHTML = `
      <div class="card">
      <div class="empty-state">
        <div class="empty-state-icon">${icon('assignment_late')}</div>
        <div class="empty-state-title">错题集为空</div>
        <div class="empty-state-desc">继续加油！答错的题目会自动收录到这里，方便你集中复习。</div>
        <button class="btn btn-primary" onclick="currentPage='practice'; renderPage();" style="min-width:160px; padding:12px 24px;">去章节练习</button>
      </div>
    </div>`;
    return;
  }

  const chapters = [...new Set(
    errorBook.map(e => {
      const q = questionBank.find(q => q.id === e.questionId);
      return q ? q.chapter : '(已删除)';
    })
  )];

  const filterHtml = `<div class="filter-pills" id="errorFilters"><button type="button" class="filter-pill active" data-filter="all">全部章节</button>${chapters.map(ch => `<button type="button" class="filter-pill" data-filter="${escAttr(ch)}">${esc(ch)}</button>`).join('')}</div>`;

  container.innerHTML = `
    <div class="page-heading"><div><h1>错题集</h1><p>回顾薄弱知识点，按章节集中复习并重新练习。</p></div><button class="btn btn-primary" id="btnRetryAll">${icon('play_circle')} 开始复习</button></div>
    ${filterHtml}
    <div class="review-summary-bar"><span>${icon('list_alt')} 共 ${errorBook.length} 道错题</span><span style="color:var(--warning)">${icon('trending_up')} 优先复习错误次数较多的题目</span></div>
    <div id="errorList"></div>
  `;

  function renderList(filter = 'all') {
    const list = $id('errorList');
    const filtered = errorBook.filter(e => {
      const q = questionBank.find(q => q.id === e.questionId);
      if (!q) return false;
      if (filter !== 'all' && q.chapter !== filter) return false;
      return true;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<p style="color:var(--text-sub); text-align:center; padding:20px">该章节暂无错题</p>';
      return;
    }

    list.innerHTML = filtered.map(e => {
      const q = questionBank.find(q => q.id === e.questionId);
      if (!q) return '';
      const meta = questionTypeMeta(q.type);
      const answerStr = formatQuestionAnswer(q);

      return `<div class="error-item collapsed">
        <div class="review-item-meta"><span class="tag ${meta.tagClass}">${esc(q.chapter)}</span><span class="tag tag-multi">错误 ${e.wrongCount} 次</span><span>${icon('schedule')} 最近答错 ${esc(e.lastWrong || '未知')}</span></div>
        <div class="review-item-heading"><span>${esc(q.question)}</span><span class="result-arrow material-symbols-outlined">expand_more</span></div>
        <div class="error-detail" style="margin-top:8px; padding-top:12px; border-top:1px solid var(--border-color); font-size:13px; color:var(--text-sub);">
          <div style="margin-bottom:10px">${q.type === 'fill' ? '参考答案' : '正确答案'}：<strong style="color:var(--correct)">${esc(answerStr)}</strong></div>
          ${renderReferenceDetail(q)}
          <button class="btn btn-sm btn-destructive" data-id="${q.id}" data-action="remove">移出错题集</button>
        </div>
      </div>`;
    }).join('');

    // 移除按钮事件
    list.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', async function() {
        errorBook = errorBook.filter(e => e.questionId !== this.dataset.id);
        await persist();
        renderList(document.querySelector('#errorFilters .active')?.dataset.filter || 'all');
      });
    });
  }

  renderList();
  $id('errorFilters').addEventListener('click', function(event) {
    const pill = event.target.closest('.filter-pill');
    if (!pill) return;
    this.querySelectorAll('.filter-pill').forEach(item => item.classList.remove('active'));
    pill.classList.add('active');
    renderList(pill.dataset.filter);
  });
  $id('btnRetryAll').addEventListener('click', () => {
    const ids = errorBook.map(e => e.questionId);
    const questions = ids.map(id => questionBank.find(q => q.id === id)).filter(Boolean);
    if (questions.length === 0) { $id('errorList').innerHTML = '<div class="empty-state"><div class="empty-state-title">没有可练习的错题</div></div>'; return; }
    startQuiz(questions, '错题重练');
  });
}

/* ================================================================
   收藏集
   ================================================================ */
function renderBookmarks(container) {
  bookmarks = bookmarks.filter(id => questionBank.some(q => q.id === id));
  if (bookmarks.length === 0) {
    container.innerHTML = `
      <div class="card"><div class="empty-state">
        <div class="empty-state-icon">${icon('star_outline')}</div>
        <div class="empty-state-title">收藏集为空</div>
        <div class="empty-state-desc">在答题页点击星标，即可将题目收藏到这里。</div>
        <button class="btn btn-primary" onclick="currentPage='practice'; renderPage();">去章节练习</button>
      </div></div>`;
    return;
  }
  const chapters = [...new Set(bookmarks.map(id => questionBank.find(q => q.id === id)?.chapter).filter(Boolean))];
  container.innerHTML = `
    <div class="page-heading"><div><h1 id="bmHeading">收藏集</h1><p>集中查看和练习主动收藏的重点题目。</p></div><button class="btn btn-primary" id="btnRetryBookmarks">${icon('play_circle')} 练习全部收藏</button></div>
    <div class="filter-pills" id="bookmarkFilters"><button type="button" class="filter-pill active" data-filter="all">全部章节</button>${chapters.map(ch => `<button type="button" class="filter-pill" data-filter="${escAttr(ch)}">${esc(ch)}</button>`).join('')}</div>
    <div class="review-summary-bar"><span>${icon('star')} 共 ${bookmarks.length} 道收藏</span><span>收藏状态会同步到答题页和搜索页</span></div>
    <div id="bookmarkList"></div>`;

  function renderBmList(filter) {
    const list = $id('bookmarkList');
    const filtered = bookmarks.filter(id => {
      const q = questionBank.find(q => q.id === id);
      if (!q) return false;
      if (filter && filter !== 'all' && q.chapter !== filter) return false;
      return true;
    });
    if (!filtered.length) { list.innerHTML = '<p style="color:var(--text-sub);text-align:center;padding:20px">该章节暂无收藏</p>'; return; }
    list.innerHTML = filtered.map(id => {
      const q = questionBank.find(q => q.id === id);
      if (!q) return '';
      const meta = questionTypeMeta(q.type);
      return `
        <div class="error-item bookmark-item collapsed">
          <div class="review-item-meta"><span class="tag ${meta.tagClass}">${meta.shortLabel}</span><span>${esc(q.chapter)}</span></div>
          <div class="review-item-heading"><span>${esc(q.question)}</span><span class="result-arrow material-symbols-outlined">expand_more</span></div>
          <div class="error-detail"><div style="margin-bottom:10px">${q.type === 'fill' ? '参考答案' : '正确答案'}：<strong style="color:var(--correct)">${esc(formatQuestionAnswer(q))}</strong></div>${renderReferenceDetail(q)}<button class="btn btn-sm btn-destructive" data-id="${escAttr(q.id)}" data-action="remove-bm">取消收藏</button></div>
        </div>`;
    }).join('');
    list.querySelectorAll('[data-action="remove-bm"]').forEach(btn => {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const i = bookmarks.indexOf(this.dataset.id);
        if (i >= 0) bookmarks.splice(i, 1);
        await persist();
        renderBmList(document.querySelector('#bookmarkFilters .active')?.dataset.filter || 'all');
      });
    });
  }

  renderBmList('all');
  $id('bookmarkFilters').addEventListener('click', function(event) {
    const pill = event.target.closest('.filter-pill');
    if (!pill) return;
    this.querySelectorAll('.filter-pill').forEach(item => item.classList.remove('active'));
    pill.classList.add('active');
    renderBmList(pill.dataset.filter);
  });
  $id('btnRetryBookmarks').addEventListener('click', () => {
    const qs = bookmarks.map(id => questionBank.find(q => q.id === id)).filter(Boolean);
    if (!qs.length) { $id('bookmarkList').innerHTML = '<div class="empty-state"><div class="empty-state-title">没有可练习的收藏题</div></div>'; return; }
    startQuiz(qs, '收藏集练习');
  });
}

/* ================================================================
   题目搜索
   ================================================================ */
function renderSearch(container) {
  container.innerHTML = `<div class="page-heading"><div><h1>题目搜索</h1><p>搜索题干、章节、选项、答案和解析。</p></div></div><div class="card search-panel"><div class="search-input-wrap">${icon('search')}<input type="search" id="searchInput" class="input" placeholder="输入关键词搜索题库..." autocomplete="off"><button type="button" id="searchClear" class="icon-button" aria-label="清除搜索" hidden>${icon('close')}</button></div><div id="searchMeta" class="search-meta"></div></div><div id="searchResults" class="search-results"></div>`;

  const input = $id('searchInput');
  const meta = $id('searchMeta');
  const results = $id('searchResults');
  const clearBtn = $id('searchClear');

  function escRx(s) {
    return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  }

  function highlight(text, kw) {
    if (!kw) return esc(text);
    const parts = esc(text).split(new RegExp('(' + escRx(kw) + ')', 'gi'));
    return parts.map((p, i) => i % 2 === 1 ? '<mark style="background:rgba(139,92,246,0.2);color:var(--primary);border-radius:2px;padding:0 2px;">' + p + '</mark>' : p).join('');
  }

  function doSearch(query) {
    clearBtn.hidden = !query;
    if (!query.trim()) {
      meta.textContent = '题库共 ' + questionBank.length + ' 题，输入关键词开始搜索';
      results.innerHTML = '';
      return;
    }
    const kw = query.toLowerCase();
    const matched = questionBank.filter(q =>
      q.question.toLowerCase().includes(kw) ||
      q.chapter.toLowerCase().includes(kw) ||
      q.options.some(o => o.toLowerCase().includes(kw)) ||
      q.answer.some(answer => answer.toLowerCase().includes(kw)) ||
      (q.explanation && q.explanation.toLowerCase().includes(kw))
    );
    meta.textContent = '找到 ' + matched.length + ' 道题';
    if (!matched.length) {
      results.innerHTML = `<div class="card"><div class="empty-state" style="padding:48px 24px;"><div class="empty-state-icon">${icon('search_off')}</div><div class="empty-state-title">未找到相关题目</div><div class="empty-state-desc">请尝试其他关键词</div></div></div>`;
      return;
    }
    results.innerHTML = matched.map(q => {
      const isBm = bookmarks.includes(q.id);
      const meta = questionTypeMeta(q.type);
      const optsHtml = q.options.map((opt, i) => {
        const l = String.fromCharCode(65+i);
        const isAns = q.answer.includes(l);
        return '<div style="font-size:13.5px;padding:6px 10px;border-radius:var(--radius-sm);background:' + (isAns?'var(--correct-bg)':'var(--bg-page)') + ';color:' + (isAns?'var(--correct)':'var(--text-sub)') + ';font-weight:' + (isAns?'600':'400') + ';margin-bottom:4px;">' + l + '. ' + highlight(opt, query) + '</div>';
      }).join('');
      const fillAnswerHtml = q.type === 'fill'
        ? `<div class="search-reference-answer"><strong>参考答案：</strong>${highlight(formatQuestionAnswer(q), query)}</div>`
        : '';
      return `<div class="search-result-card">
        <div class="search-result-heading">
          <div><span class="tag ${meta.tagClass}">${meta.shortLabel}</span><span class="search-chapter">${esc(q.chapter)}</span></div>
          <button class="quiz-icon-action quiz-bookmark-btn ${isBm ? 'bookmarked' : ''} search-bm-btn" data-id="${escAttr(q.id)}" title="${isBm ? '取消收藏' : '收藏此题'}" aria-label="${isBm ? '取消收藏' : '收藏此题'}">${icon(isBm ? 'star' : 'star_outline')}</button>
        </div>
        <div class="search-question">${highlight(q.question, query)}</div>
        ${renderQuestionImage(q, 'result-question-image')}
        ${optsHtml}${fillAnswerHtml}
        ${q.explanation ? `<div class="search-explanation"><strong>解析：</strong>${highlight(q.explanation, query)}</div>` : ''}
      </div>`;
    }).join('');
    results.querySelectorAll('.search-bm-btn').forEach(btn => {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const qId = this.dataset.id;
        const bi = bookmarks.indexOf(qId);
        if (bi >= 0) { bookmarks.splice(bi, 1); this.innerHTML = icon('star_outline'); this.classList.remove('bookmarked'); this.title='收藏此题'; }
        else { bookmarks.push(qId); this.innerHTML = icon('star'); this.classList.add('bookmarked'); this.title='取消收藏'; }
        await persist();
      });
    });
  }

  meta.textContent = '题库共 ' + questionBank.length + ' 题，输入关键词开始搜索';
  let debounce;
  input.addEventListener('input', function() { clearTimeout(debounce); debounce = setTimeout(() => doSearch(this.value), 200); });
  clearBtn.addEventListener('click', () => { input.value = ''; doSearch(''); input.focus(); });
  input.focus();
}

/* ================================================================
   模拟考试
   ================================================================ */
function renderExamConfig(container) {

  const chapters = getChapters();
  if (chapters.length === 0) {
    container.innerHTML = `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">🎯</div>
          <div class="empty-state-title">暂无题目</div>
          <div class="empty-state-desc">请先到「题库管理」导入 Excel 题库，然后回来配置考试。</div>
          <button class="btn btn-primary" onclick="currentPage='manage'; renderPage();" style="min-width:160px; padding:12px 24px;">去题库管理</button>
        </div>
      </div>`;
    return;
  }

  const totalSingle = questionBank.filter(q => q.type === 'single').length;
  const totalFill = questionBank.filter(q => q.type === 'fill').length;
  const defaultSingle = Math.min(10, totalSingle);
  const defaultFill = Math.min(5, totalFill);

  container.innerHTML = `
    <div class="page-heading"><div><h1>配置模拟考试</h1><p>选择考试章节，并设置各题型数量。系统会从所选范围随机组卷。</p></div></div>
    <div class="exam-layout">
      <section class="card exam-panel">
        <div class="exam-section-title"><div><h2>选择章节</h2><p>选择一个或多个内容范围</p></div><div><button class="text-button" id="btnSelectAll">全选</button><button class="text-button" id="btnDeselectAll">清空</button></div></div>
        <div id="examChapters" class="exam-chapter-grid">
          ${chapters.map(ch => {
            const single = questionBank.filter(q => q.chapter === ch && q.type === 'single').length;
            const fill = questionBank.filter(q => q.chapter === ch && q.type === 'fill').length;
            return `<label class="exam-chapter-card selected">
              <input type="checkbox" value="${escAttr(ch)}" class="exam-chk" checked>
              <div class="exam-chapter-card-body">
                <div class="exam-chapter-card-name">${esc(ch)}</div>
                <div class="exam-chapter-card-count">单选 ${single} · 填空 ${fill}</div>
              </div>
            </label>`;
          }).join('')}
        </div>
        <p id="availableHint" class="page-subtitle" style="margin-top:16px"></p>
      </section>
      <aside class="exam-side">
        <section class="card exam-panel">
          <div class="exam-section-title"><div><h2>题型分布</h2><p>按题型设置抽题数量</p></div></div>
          <div class="exam-count-row">
            <label class="exam-count-item"><span class="exam-count-label">单选题</span><input type="number" class="exam-count-input" id="examSingleCount" value="${defaultSingle}" min="0" max="${totalSingle}"><span class="exam-count-sub">最多 ${totalSingle} 题</span></label>
            <label class="exam-count-item"><span class="exam-count-label">填空题</span><input type="number" class="exam-count-input" id="examFillCount" value="${defaultFill}" min="0" max="${totalFill}"><span class="exam-count-sub">最多 ${totalFill} 题</span></label>
          </div>
          <div class="range-error" id="examConfigError" role="alert"></div>
        </section>
        <section class="exam-summary">
          <h3>考试摘要</h3>
          <div class="exam-summary-list">
            <div class="exam-summary-row"><span>总题数</span><strong id="examSummaryTotal">${defaultSingle + defaultFill}</strong></div>
            <div class="exam-summary-row"><span>考试总分</span><strong>100 分</strong></div>
            <div class="exam-summary-row"><span>预计用时</span><strong id="examSummaryDuration">${Math.max(10, (defaultSingle + defaultFill) * 2)} 分钟</strong></div>
          </div>
          <div class="exam-summary-footer"><button class="btn" id="btnStartExam">${icon('play_circle')} 开始考试</button></div>
        </section>
      </aside>
    </div>
  `;

  function updateHint() {
    const selectedChs = [...document.querySelectorAll('.exam-chk:checked')].map(cb => cb.value);
    const availSingle = questionBank.filter(q => selectedChs.includes(q.chapter) && q.type === 'single').length;
    const availFill = questionBank.filter(q => selectedChs.includes(q.chapter) && q.type === 'fill').length;
    const hint = $id('availableHint');
    const singleCount = Math.max(0, parseInt($id('examSingleCount').value) || 0);
    const fillCount = Math.max(0, parseInt($id('examFillCount').value) || 0);
    const requested = singleCount + fillCount;
    const issues = [];
    if (!selectedChs.length) issues.push('请至少选择一个章节');
    if (!requested) issues.push('请至少设置一种题型');
    if (singleCount > availSingle) issues.push(`单选题最多可选 ${availSingle} 题`);
    if (fillCount > availFill) issues.push(`填空题最多可选 ${availFill} 题`);
    if (hint) hint.textContent = `已选章节可用：单选 ${availSingle} 题 · 填空 ${availFill} 题`;
    $id('examSummaryTotal').textContent = requested;
    $id('examSummaryDuration').textContent = `${Math.max(10, requested * 2)} 分钟`;
    $id('examConfigError').textContent = issues[0] || '';
    $id('btnStartExam').disabled = issues.length > 0;
  }

  updateHint();
  document.getElementById('examChapters').addEventListener('change', function(e) {
    if (e.target.classList.contains('exam-chk')) {
      const card = e.target.closest('.exam-chapter-card');
      if (card) card.classList.toggle('selected', e.target.checked);
    }
    updateHint();
  });
  $id('btnSelectAll').addEventListener('click', () => {
    document.querySelectorAll('.exam-chk').forEach(cb => {
      cb.checked = true;
      const card = cb.closest('.exam-chapter-card');
      if (card) card.classList.add('selected');
    });
    updateHint();
  });
  $id('btnDeselectAll').addEventListener('click', () => {
    document.querySelectorAll('.exam-chk').forEach(cb => {
      cb.checked = false;
      const card = cb.closest('.exam-chapter-card');
      if (card) card.classList.remove('selected');
    });
    updateHint();
  });
  ['examSingleCount', 'examFillCount'].forEach(id => $id(id).addEventListener('input', updateHint));

  $id('btnStartExam').addEventListener('click', () => {
    const selectedChs = [...document.querySelectorAll('.exam-chk:checked')].map(cb => cb.value);
    if (selectedChs.length === 0) { $id('examConfigError').textContent = '请至少选择一个章节'; return; }

    const singleCount = parseInt($id('examSingleCount').value) || 0;
    const fillCount = parseInt($id('examFillCount').value) || 0;
    if (singleCount === 0 && fillCount === 0) { $id('examConfigError').textContent = '请至少设置一种题型的数量'; return; }

    const poolSingle = shuffle(questionBank.filter(q => selectedChs.includes(q.chapter) && q.type === 'single'));
    const poolFill = shuffle(questionBank.filter(q => selectedChs.includes(q.chapter) && q.type === 'fill'));

    if (singleCount > poolSingle.length) {
      $id('examConfigError').textContent = `单选题不足：需要 ${singleCount} 题，但只有 ${poolSingle.length} 题可用`;
      return;
    }
    if (fillCount > poolFill.length) {
      $id('examConfigError').textContent = `填空题不足：需要 ${fillCount} 题，但只有 ${poolFill.length} 题可用`;
      return;
    }

    const examQuestions = shuffle([
      ...poolSingle.slice(0, singleCount),
      ...poolFill.slice(0, fillCount)
    ]);

    startQuiz(examQuestions, '模拟考试');
  });
}

/* ================================================================
   工具函数
   ================================================================ */
function countValidErrors() {
  return errorBook.filter(e => questionBank.some(q => q.id === e.questionId)).length;
}

function chapterSequenceNumber(chapterName) {
  const subName = String(chapterName).split(' - ').slice(1).join(' - ') || String(chapterName);
  const match = subName.match(/^\s*(?:第\s*)?[（(]?\s*([0-9]+|[零〇一二两三四五六七八九十百]+)\s*[）)]?/);
  if (!match) return Number.POSITIVE_INFINITY;

  const numeral = match[1];
  if (/^\d+$/.test(numeral)) return Number(numeral);

  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100 };
  let total = 0;
  let currentDigit = 0;

  for (const char of numeral) {
    if (Object.prototype.hasOwnProperty.call(digits, char)) {
      currentDigit = digits[char];
    } else if (units[char]) {
      total += (currentDigit || 1) * units[char];
      currentDigit = 0;
    }
  }

  return total + currentDigit;
}

function compareChapterNames(a, b) {
  const [parentA, ...subPartsA] = String(a).split(' - ');
  const [parentB, ...subPartsB] = String(b).split(' - ');

  // Keep the existing source-group order, then sort chapters by their displayed number.
  if (parentA !== parentB) return parentA < parentB ? -1 : 1;

  const sequenceA = chapterSequenceNumber(a);
  const sequenceB = chapterSequenceNumber(b);
  if (sequenceA !== sequenceB) return sequenceA - sequenceB;

  const subNameA = subPartsA.join(' - ') || parentA;
  const subNameB = subPartsB.join(' - ') || parentB;
  return subNameA.localeCompare(subNameB, 'zh-CN', { numeric: true });
}

function getChapters() {
  return [...new Set(questionBank.map(q => q.chapter))].sort(compareChapterNames);
}

function addToErrorBook(questionId) {
  const entry = errorBook.find(e => e.questionId === questionId);
  if (entry) {
    entry.wrongCount++;
    entry.lastWrong = new Date().toISOString().slice(0, 10);
  } else {
    errorBook.push({
      questionId,
      wrongCount: 1,
      lastWrong: new Date().toISOString().slice(0, 10)
    });
  }
  persist();
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 主题切换与初始化函数
function initTheme() {
  const btn = $id('themeToggleBtn');
  if (!btn) return;

  let theme = settings.theme;
  if (!theme) {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  applyTheme(theme);

  btn.addEventListener('click', async () => {
    const currentTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    settings.theme = nextTheme;
    await persist();
  });
}

function applyTheme(theme) {
  const btn = $id('themeToggleBtn');
  if (!btn) return;
  if (theme === 'dark') {
    document.body.classList.add('dark');
    btn.innerHTML = icon('light_mode');
    btn.setAttribute('title', '切换至亮色模式');
    btn.setAttribute('aria-label', '切换至亮色模式');
  } else {
    document.body.classList.remove('dark');
    btn.innerHTML = icon('dark_mode');
    btn.setAttribute('title', '切换至暗色模式');
    btn.setAttribute('aria-label', '切换至暗色模式');
  }
}

function initAppShell() {
  $id('mobileMenuButton')?.addEventListener('click', () => document.body.classList.add('sidebar-open'));
  $id('sidebarScrim')?.addEventListener('click', closeMobileSidebar);
  $id('lockApplication')?.addEventListener('click', () => {
    localStorage.removeItem('quiz_access');
    document.documentElement.classList.add('access-locked');
    const gate = $id('accessGate');
    if (gate) gate.hidden = false;
    $id('accessPassword')?.focus();
  });
}

/* ================================================================
   PWA - Manifest & Service Worker
   ================================================================ */
(function() {
  // 动态生成 Web App Manifest（Blob URL 避免独立文件）
  const manifest = {
    name: '刷题助手',
    short_name: '刷题助手',
    description: '一款简单好用的刷题工具',
    start_url: '.',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#f8fafc',
    orientation: 'any',
    icons: [{
      src: 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192">' +
        '<rect width="192" height="192" rx="38" fill="#4f46e5"/>' +
        '<text x="96" y="122" font-size="105" fill="white" text-anchor="middle" font-family="sans-serif">📝</text>' +
        '</svg>'
      ),
      sizes: '192x192',
      type: 'image/svg+xml',
      purpose: 'any'
    }, {
      src: 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' +
        '<rect width="512" height="512" rx="102" fill="#4f46e5"/>' +
        '<text x="256" y="330" font-size="280" fill="white" text-anchor="middle" font-family="sans-serif">📝</text>' +
        '</svg>'
      ),
      sizes: '512x512',
      type: 'image/svg+xml',
      purpose: 'any'
    }]
  };

  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  var link = document.getElementById('manifestLink');
  if (link) link.href = url;

  // 注册 Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(function(reg) {
        console.log('Service Worker 已注册，离线缓存可用');
      })
      .catch(function(err) {
        console.log('Service Worker 注册失败（如果使用 file:// 协议这是正常的）:', err.message);
      });
  }
})();

/* ================================================================
   初始化
   ================================================================ */
// 全局事件委托：答题结果与错题展开/收起
$id('container').addEventListener('click', function(e) {
  // 1. 处理答题结果卡片展开/收起
  const resultItem = e.target.closest('.result-item');
  if (resultItem) {
    resultItem.classList.toggle('expanded');
    return;
  }

  // 2. 处理错题卡片展开/收起（排除点击“移除”按钮）
  const errorItem = e.target.closest('.error-item');
  if (errorItem && !e.target.closest('button')) {
    errorItem.classList.toggle('expanded');
    return;
  }
});

// 异步启动入口
async function initApp() {
  await initData();
  initTheme();
  initAppShell();
  renderPage();
}

initApp();
