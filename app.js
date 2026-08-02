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

function isFillAnswerCorrect(userAnswer, correctAnswer) {
  const user = (userAnswer || []).map(normalizeAnswerText).filter(Boolean);
  const correct = (correctAnswer || []).map(value => String(value || '').trim()).filter(Boolean);
  if (!user.length || !correct.length) return false;

  if (user.length === correct.length) {
    return correct.every((expected, index) => {
      const variants = expected.split(/[|｜/]/).map(normalizeAnswerText).filter(Boolean);
      return variants.includes(user[index]);
    });
  }

  return normalizeAnswerText(user.join('')) === normalizeAnswerText(correct.join(''));
}

function hasUserAnswer(answer) {
  return Array.isArray(answer) && answer.some(value => String(value || '').trim());
}

function formatQuestionAnswer(question) {
  if (question.type === 'fill') return question.answer.join(' / ');
  return question.answer.join(', ');
}

function questionImageSource(question) {
  return questionImages[question.id] || question.image || '';
}

function renderQuestionImage(question, className = 'question-image') {
  const src = questionImageSource(question);
  if (!src) return '';
  return `<figure class="${className}"><img src="${escAttr(src)}" alt="${escAttr(question.id + ' 题图')}" loading="lazy"></figure>`;
}

const DEFAULT_QUESTIONS = window.DEFAULT_QUESTIONS || [];

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

document.getElementById('navBar').addEventListener('click', function(e) {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  item.classList.add('active');
  currentPage = item.dataset.page;
  renderPage();
});

/* ================================================================
   页面渲染入口
   ================================================================ */
function renderPage() {
  const c = $id('container');
  switch (currentPage) {
    case 'practice': renderChapterList(c); break;
    case 'exam-config': renderExamConfig(c); break;
    case 'errors': renderErrorBook(c); break;
    case 'bookmarks': renderBookmarks(c); break;
    case 'search': renderSearch(c); break;
    case 'manage': renderManage(c); break;
  }
}

/* ================================================================
   题库管理（导入/导出/清空）
   ================================================================ */
function renderManage(container) {
  const chapters = getChapters();
  const totalSingle = questionBank.filter(q => q.type === 'single').length;
  const totalMulti = questionBank.filter(q => q.type === 'multi').length;
  const totalFill = questionBank.filter(q => q.type === 'fill').length;
  const imageCount = questionBank.filter(q => questionImageSource(q)).length;
  let chaptersHtml = '';
  if (chapters.length === 0) {
    chaptersHtml = '<p style="color:var(--text-sub); font-weight:500;">暂无题目，请先导入题库</p>';
  } else {
    chaptersHtml = chapters.map(ch => {
      const qs = questionBank.filter(q => q.chapter === ch);
      const single = qs.filter(q => q.type === 'single').length;
      const multi = qs.filter(q => q.type === 'multi').length;
      const fill = qs.filter(q => q.type === 'fill').length;
      return `<div class="chapter-card" style="cursor:default">
        <div class="chapter-card-num">${chapters.indexOf(ch)+1}</div>
        <span class="chapter-card-name">${esc(ch)}</span>
        <span class="chapter-card-badge">单选 ${single} · 多选 ${multi} · 填空 ${fill}</span>
      </div>`;
    }).join('');
  }

  container.innerHTML = `
    <div class="card">
      <h2 style="font-size:22px; font-weight:700; margin-bottom:24px;">题库管理</h2>

      <div class="stats-row" style="margin-bottom:28px">
        <div class="manage-stat-item"><div class="manage-stat-num">${questionBank.length}</div><div class="manage-stat-label">总题数</div></div>
        <div class="manage-stat-item"><div class="manage-stat-num">${totalSingle + totalMulti}</div><div class="manage-stat-label">选择题</div></div>
        <div class="manage-stat-item"><div class="manage-stat-num">${totalFill}</div><div class="manage-stat-label">填空题</div></div>
        <div class="manage-stat-item"><div class="manage-stat-num">${imageCount}</div><div class="manage-stat-label">已关联题图</div></div>
        <div class="manage-stat-item"><div class="manage-stat-num">${countValidErrors()}</div><div class="manage-stat-label">错题数</div></div>
      </div>

      <div class="upload-zone-lg" id="uploadZone">
        <div class="upload-zone-lg-icon">📂</div>
        <div class="upload-zone-lg-title">点击或拖拽 Excel 题库文件到此处</div>
        <div class="upload-zone-lg-sub">支持 .xlsx 格式 · 重复题目自动跳过</div>
        <input type="file" id="fileInput" accept=".xlsx" style="display:none">
      </div>

      <div id="importMsg" style="margin-top:16px;"></div>

      <div class="image-upload-row">
        <div>
          <strong>题图关联</strong>
          <p>图片文件名需与题目 ID 一致，例如 <code>JX-LG-029.png</code>。可一次选择多张。</p>
        </div>
        <button class="btn" id="btnChooseImages">选择题图</button>
        <input type="file" id="imageInput" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple hidden>
      </div>

      <div style="margin-top:24px;">
        <div style="font-size:12px; font-weight:700; color:var(--text-sub); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px;">常规操作</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:20px;">
          <button class="btn btn-primary" id="btnExport">⬇ 导出完整备份</button>
          <button class="btn" id="btnExportErrors">⬇ 导出错题集 JSON</button>
        </div>
        <div style="font-size:12px; font-weight:700; color:#DC2626; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:12px;">⚠ 危险操作</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-destructive" id="btnClear">🗑 清空题库</button>
          <button class="btn btn-destructive" id="btnClearErrors">🗑 清空错题集</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="font-size:16px; font-weight:700; margin-bottom:16px;">题库总览</h3>
      ${chaptersHtml}
    </div>

    <div class="info-alert">
      <strong>📋 Excel 模板格式说明</strong>
      <p style="margin-top:10px; color:var(--text-sub); font-size:13.5px; font-weight:500; line-height:1.8;">
        列顺序：章节 | 题型 | 题目 | 选项A | 选项B | 选项C | 选项D | ... | 正确答案 | 解析<br>
        程序会自动查找真正的表头行，并识别“单选”“多选”“填空”或“填空题”。<br>
        填空题无需选项；多个空的答案按出现顺序用中文或英文逗号分隔。可选图片列名：题图、图片、图片路径。
      </p>
    </div>
  `;

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
    version: 14,
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
    if (confirm(confirmMsg)) {
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
    if (confirm('确定要清空错题集吗？')) {
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
      let newCount = 0, updateCount = 0, skipCount = 0, invalidCount = 0;
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
        const providedId = idIdx >= 0 ? String(row[idIdx] || '').trim() : '';

        const key = finalChapter + '|||' + question;
        const existingIndex = providedId
          ? existingIds.get(providedId)
          : existingKeys.get(key);

        let type = normalizeQuestionType(typeStr);
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
      showImportMsg('success', `导入完成：新增 ${newCount} 题，更新 ${updateCount} 题，跳过重复 ${skipCount} 题，格式无效 ${invalidCount} 题`);
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
      const multi = qs.filter(q => q.type === 'multi').length;
      const fill = qs.filter(q => q.type === 'fill').length;
      totalQuestions += qs.length;
      return `<div class="chapter-card" data-chapter="${escAttr(item.fullName)}">
        <div class="chapter-card-num">${subItems.indexOf(item)+1}</div>
        <span class="chapter-card-name">${esc(item.subName)}</span>
        <span class="chapter-card-badge">单选 ${single} · 多选 ${multi} · 填空 ${fill}</span>
      </div>`;
    }).join('');

    // 默认展示全部展开状态（添加 .expanded 类）
    return `<div class="chapter-group expanded" data-group-index="${idx}">
      <div class="chapter-group-header">
        <span class="group-title">📁 ${esc(parent)}</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="chapter-badge" style="font-weight:600; background:var(--primary-light); color:var(--primary); padding:3px 8px; border-radius:12px; font-size:12px;">共 ${totalQuestions} 题</span>
          <span class="group-arrow">▼</span>
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
    <div class="modal" style="max-width: 440px; width: 90%;">
      <div class="modal-title" style="margin-bottom: 8px;">🎯 刷题配置</div>
      <p style="color: var(--text-sub); font-size: 14px; margin-bottom: 20px; font-weight: 500;">
        章节：${esc(chapter)}
      </p>

      <div style="margin-bottom: 20px;">
        <label style="font-weight: 600; font-size: 14px; display: block; margin-bottom: 12px; color: var(--text-main);">选择刷题范围：</label>

        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap;">
          <span style="color: var(--text-sub); font-size: 14px; font-weight: 500;">从第</span>
          <input type="number" class="input" id="practiceStartInput" value="1" min="1" max="${total}" style="width: 80px; font-weight: 600; text-align: center;">
          <span style="color: var(--text-sub); font-size: 14px; font-weight: 500;">题，到第</span>
          <input type="number" class="input" id="practiceEndInput" value="${total}" min="1" max="${total}" style="width: 80px; font-weight: 600; text-align: center;">
          <span style="color: var(--text-sub); font-size: 14px; font-weight: 500;">题</span>
        </div>

        <div style="color: var(--text-sub); font-size: 13px; margin-bottom: 16px; font-weight: 600;">
          本次共选择：<span id="rangeCountText" style="color: var(--primary); font-size: 16px; font-weight: 700;">${total}</span> 道题（章节总共 ${total} 题）
        </div>

        <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 10px;">
          ${quickButtonsHtml}
        </div>
      </div>

      <div class="modal-footer" style="margin-top: 24px;">
        <button class="btn" id="btnPracticeCancel">取消</button>
        <button class="btn btn-primary" id="btnPracticeStart">开始刷题</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const startInput = overlay.querySelector('#practiceStartInput');
  const endInput = overlay.querySelector('#practiceEndInput');
  const countText = overlay.querySelector('#rangeCountText');

  function updateRangeCount() {
    const start = parseInt(startInput.value);
    const end = parseInt(endInput.value);
    if (!isNaN(start) && !isNaN(end) && start >= 1 && end >= start && end <= total) {
      countText.textContent = end - start + 1;
    } else {
      countText.textContent = '--';
    }
  }

  startInput.addEventListener('input', updateRangeCount);
  endInput.addEventListener('input', updateRangeCount);

  overlay.querySelector('#btnPracticeCancel').addEventListener('click', () => { overlay.remove(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

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
    if (isNaN(start) || isNaN(end) || start < 1 || end < start || end > total) {
      alert(`请输入有效的刷题范围！范围必须在 1 到 ${total} 之间，且结束题数不能小于起始题数。`);
      return;
    }
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
  const typeMeta = questionTypeMeta(q.type);
  const gridClass = q.displayOptions.length > 4 ? 'single-col' : '';
  const selected = quizState.answers[idx] || [];
  const answeredCount = quizState.answers.filter(hasUserAnswer).length;

  const isFlagged = quizState.flagged.includes(q.id);

  // 题目导航按钮
  let navHtml = `<div class="quiz-nav-sidebar ${quizState.navCollapsed ? 'collapsed' : ''}" id="quizNavSidebar">`;
  for (let i = 0; i < total; i++) {
    const qId = quizState.questions[i].id;
    const isQFlagged = quizState.flagged.includes(qId);
    const cls = [
      i === idx ? 'current' : '',
      hasUserAnswer(quizState.answers[i]) ? 'answered' : '',
      isQFlagged ? 'flagged' : ''
    ].filter(Boolean).join(' ');
    navHtml += `<span class="quiz-nav-dot ${cls}" data-idx="${i}">${i + 1}</span>`;
  }
  navHtml += '</div>';

  $id('container').innerHTML = `
    <div class="card">
      <div class="quiz-header">
        <span class="tag ${typeMeta.tagClass}">${typeMeta.label}</span>
        <div style="display:flex; align-items:center; gap:12px;">
          <span class="quiz-progress">第 ${idx + 1} 题 / 共 ${total} 题 · 已答 ${answeredCount} 题</span>
          <button class="btn btn-sm" id="btnToggleFlag" style="padding: 4px 10px; font-size: 12px; font-weight: 600; border-color: ${isFlagged ? 'var(--warning)' : 'var(--border-color)'}; color: ${isFlagged ? 'var(--warning)' : 'var(--text-sub)'}; background: ${isFlagged ? 'var(--warning-bg)' : 'transparent'};">
            ${isFlagged ? '🚩 已标记' : '🏳️ 标记此题'}
          </button>
          <button class="btn btn-sm quiz-bookmark-btn ${bookmarks.includes(q.id) ? 'bookmarked' : ''}" id="btnToggleBookmark">
            ${bookmarks.includes(q.id) ? '⭐' : '☆'}
          </button>
          <button class="btn btn-sm" id="btnToggleNav" style="padding: 4px 10px; font-size: 12px; font-weight: 600; border-color: var(--primary); color: var(--primary);">${quizState.navCollapsed ? '展开题号' : '收起题号'}</button>
        </div>
      </div>

      ${navHtml}

      <div class="question-row">
        <div class="question-num ${(idx + 1) >= 100 ? 'num-lg' : ''}">${idx + 1}</div>
        <div class="question-text">${esc(q.question)}</div>
      </div>

      ${renderQuestionImage(q)}

      ${isFill ? `
        <div class="fill-answer-panel" id="fillAnswerPanel">
          <div class="fill-answer-label">填写答案</div>
          ${Array.from({ length: countFillBlanks(q) }, (_, inputIndex) => `
            <label class="fill-answer-field">
              ${countFillBlanks(q) > 1 ? `<span>第 ${inputIndex + 1} 空</span>` : ''}
              <input class="input fill-answer-input" data-fill-index="${inputIndex}" value="${escAttr(selected[inputIndex] || '')}" autocomplete="off" placeholder="输入答案">
            </label>
          `).join('')}
          <p>自动判分会忽略空格、常见标点和大小写；多个空请按题目顺序填写。</p>
        </div>
      ` : `
        <div class="options-grid ${gridClass}" id="optionsGrid">
          ${q.displayOptions.map(opt => `
            <button type="button" class="option-btn ${selected.includes(opt.letter) ? 'selected' : ''}" data-letter="${opt.letter}">
              <span class="option-letter">${opt.letter}</span>
              <span>${esc(opt.text)}</span>
            </button>
          `).join('')}
        </div>
      `}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px">
        <button class="btn" id="btnPrev" ${idx === 0 ? 'disabled' : ''}>上一题</button>
        <span style="color:var(--text-sub); font-size:13px; font-weight:500;">${isFill ? '填写完成后可继续下一题' : (isMulti ? '点击选项可切换选中/取消' : '点击选项选中答案')}</span>
        ${idx < total - 1
          ? '<button class="btn btn-primary" id="btnNext">下一题</button>'
          : '<button class="btn btn-primary" id="btnSubmit">交卷</button>'
        }
      </div>
    </div>
  `;

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
      btn.textContent = isCollapsed ? '展开题号' : '收起题号';
    }
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
    $id('btnSubmit').addEventListener('click', () => {
      const unanswered = quizState.answers.filter(answer => !hasUserAnswer(answer)).length;
      let msg = '确定要交卷吗？';
      if (unanswered > 0) msg += `\n还有 ${unanswered} 题未作答，交卷后未答题将计为错误。`;
      if (confirm(msg)) submitQuiz();
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
      ? isFillAnswerCorrect(userAnswer, q.answer)
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
  let scoreHtml = '';

  const isExam = quizState.chapter === '模拟考试';

  if (isExam) {
    perQuestionScore = total > 0 ? 100 / total : 0;
    results.forEach(r => {
      if (r.isCorrect) {
        earnedScore += perQuestionScore;
      }
    });

    const displayEarned = Math.round(earnedScore * 10) / 10;
    const displayPerQuestion = Math.round(perQuestionScore * 100) / 100;

    scoreHtml = `
      <div class="card" style="text-align:center; background:var(--primary-light); border-color:var(--primary); margin-bottom:20px;">
        <h3 style="font-size:16px; font-weight:600; color:var(--primary); margin-bottom:8px;">模拟考试得分</h3>
        <div style="font-size:54px; font-weight:800; color:var(--primary); font-family:'Outfit', sans-serif;">
          ${displayEarned} <span style="font-size:18px; font-weight:500; color:var(--text-sub);">/ 100 分</span>
        </div>
        <p style="font-size:12px; color:var(--text-sub); margin-top:8px; font-weight:500;">
          单选、多选和填空均按题计分：每题 ${displayPerQuestion} 分
        </p>
      </div>
    `;
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
      const statusIcon = '❌';
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
            <span class="result-arrow" style="flex-shrink:0; font-size:12px; color:var(--text-sub); transition:transform 0.2s;">▶</span>
          </div>
          <div class="result-detail" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border-color); font-size:13px; color:var(--text-sub);">
            ${renderQuestionImage(r, 'result-question-image')}
            ${optionsDetail ? `<div style="margin-bottom:8px;"><strong>选项：</strong>${optionsDetail}</div>` : ''}
            <div style="margin-bottom:6px; color:var(--text-main);">你的答案：<strong style="color:${statusColor}">${userDisplay}</strong></div>
            <div style="margin-bottom:6px; color:var(--text-main);">${r.type === 'fill' ? '参考答案' : '正确答案'}：<strong style="color:var(--correct)">${esc(correctDisplay)}</strong></div>
            ${r.explanation ? `<div class="explanation" style="margin-top:8px"><strong>解析：</strong>${esc(r.explanation)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  $id('container').innerHTML = `
    ${scoreHtml}
    <div class="card" style="text-align:center">
      <div style="font-size:48px; margin-bottom:16px">${pct >= 60 ? '🎉' : '💪'}</div>
      <h2 style="font-size:22px; font-weight:700;">${quizState.chapter} · 答题结果</h2>
      <div class="stats-row" style="justify-content:center; margin:24px 0">
        <div class="stat-item">
          <div class="stat-num">${total}</div>
          <div class="stat-label">总题数</div>
        </div>
        <div class="stat-item">
          <div class="stat-num" style="color:var(--correct)">${correct}</div>
          <div class="stat-label">正确</div>
        </div>
        <div class="stat-item">
          <div class="stat-num" style="color:var(--wrong)">${wrong}</div>
          <div class="stat-label">错误</div>
        </div>
        <div class="stat-item">
          <div class="stat-num">${pct}%</div>
          <div class="stat-label">正确率</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="font-size:18px; font-weight:700; margin-bottom:16px">答题详情</h3>
      ${detailHtml}
    </div>

    <div style="text-align:center; margin-top:20px;">
      <button class="btn btn-primary" id="btnBack">返回章节列表</button>
    </div>
  `;
  $id('btnBack').addEventListener('click', () => { currentPage = 'practice'; renderPage(); });
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
        <div class="empty-state-icon">📝</div>
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

  const filterHtml = `
    <select class="select" id="errorFilter">
      <option value="all">全部章节</option>
      ${chapters.map(ch => `<option value="${escAttr(ch)}">${esc(ch)}</option>`).join('')}
    </select>
    <button class="btn btn-primary btn-sm" id="btnRetryAll" style="margin-left:12px">重新练习全部</button>
  `;

  container.innerHTML = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px">
        <h2 style="font-size:20px; font-weight:700;">错题集 · ${errorBook.length} 题</h2>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">${filterHtml}</div>
      </div>
      <div id="errorList"></div>
    </div>
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

      return `<div class="error-item collapsed" style="display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
          <span style="font-weight:600; line-height:1.5;"><span class="tag ${meta.tagClass}" style="margin-right:6px;">${meta.shortLabel}</span>${esc(q.question)}</span>
          <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
            <span class="tag tag-multi">错误 ${e.wrongCount} 次</span>
            <span class="result-arrow" style="font-size:12px; color:var(--text-sub); transition:transform 0.2s;">▶</span>
          </div>
        </div>
        <div style="font-size:13px; color:var(--text-sub); font-weight:500;">
          ${q.type === 'fill' ? '参考答案' : '正确答案'}：<strong style="color:var(--correct)">${esc(answerStr)}</strong> · 章节：${esc(q.chapter)}
          <button class="btn btn-sm btn-danger" style="margin-left:8px; padding:3px 8px; font-size:11px;" data-id="${q.id}" data-action="remove">移除</button>
        </div>
        <div class="error-detail" style="margin-top:8px; padding-top:12px; border-top:1px solid var(--border-color); font-size:13px; color:var(--text-sub);">
          ${renderReferenceDetail(q)}
        </div>
      </div>`;
    }).join('');

    // 移除按钮事件
    list.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', async function() {
        errorBook = errorBook.filter(e => e.questionId !== this.dataset.id);
        await persist();
        renderList($id('errorFilter').value);
      });
    });
  }

  renderList();
  $id('errorFilter').addEventListener('change', function() { renderList(this.value); });
  $id('btnRetryAll').addEventListener('click', () => {
    const ids = errorBook.map(e => e.questionId);
    const questions = ids.map(id => questionBank.find(q => q.id === id)).filter(Boolean);
    if (questions.length === 0) { alert('没有可练习的错题'); return; }
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
        <div class="empty-state-icon">☆</div>
        <div class="empty-state-title">收藏集为空</div>
        <div class="empty-state-desc">在答题页点击星标，即可将题目收藏到这里。</div>
        <button class="btn btn-primary" onclick="currentPage='practice'; renderPage();">去章节练习</button>
      </div></div>`;
    return;
  }
  const chapters = [...new Set(bookmarks.map(id => questionBank.find(q => q.id === id)?.chapter).filter(Boolean))];
  container.innerHTML = `
    <div class="card">
      <div class="section-toolbar">
        <h2 id="bmHeading">收藏集 · ${bookmarks.length} 题</h2>
        <div class="toolbar-actions">
          <select class="select" id="bookmarkFilter">
            <option value="all">全部章节</option>
            ${chapters.map(ch => `<option value="${escAttr(ch)}">${esc(ch)}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" id="btnRetryBookmarks">重新练习全部</button>
        </div>
      </div>
      <div id="bookmarkList"></div>
    </div>`;

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
        <div class="error-item collapsed">
          <div class="review-item-heading">
            <span><span class="tag ${meta.tagClass}">${meta.shortLabel}</span>${esc(q.question)}</span>
            <span class="result-arrow">▶</span>
          </div>
          <div class="review-item-meta">
            ${q.type === 'fill' ? '参考答案' : '正确答案'}：<strong>${esc(formatQuestionAnswer(q))}</strong> · 章节：${esc(q.chapter)}
            <button class="btn btn-sm btn-destructive" data-id="${escAttr(q.id)}" data-action="remove-bm">移除</button>
          </div>
          <div class="error-detail">${renderReferenceDetail(q)}</div>
        </div>`;
    }).join('');
    list.querySelectorAll('[data-action="remove-bm"]').forEach(btn => {
      btn.addEventListener('click', async function(e) {
        e.stopPropagation();
        const i = bookmarks.indexOf(this.dataset.id);
        if (i >= 0) bookmarks.splice(i, 1);
        await persist();
        const h2 = $id('bmHeading');
        if (h2) h2.textContent = '⭐ 收藏集 · ' + bookmarks.length + ' 题';
        renderBmList($id('bookmarkFilter') ? $id('bookmarkFilter').value : 'all');
      });
    });
  }

  renderBmList('all');
  $id('bookmarkFilter').addEventListener('change', function() { renderBmList(this.value); });
  $id('btnRetryBookmarks').addEventListener('click', () => {
    const qs = bookmarks.map(id => questionBank.find(q => q.id === id)).filter(Boolean);
    if (!qs.length) { alert('没有可练习的收藏题'); return; }
    startQuiz(qs, '收藏集练习');
  });
}

/* ================================================================
   题目搜索
   ================================================================ */
function renderSearch(container) {
  container.innerHTML = '<div class="card" style="margin-bottom:0;"><h2 style="font-size:20px; font-weight:700; margin-bottom:16px;">🔍 题目搜索</h2><div style="position:relative; margin-bottom:8px;"><input type="text" id="searchInput" class="input" placeholder="输入关键词搜索题目、选项或章节名..." style="width:100%; padding:14px 20px 14px 48px; font-size:16px; border-radius:var(--radius-lg); box-sizing:border-box;"><span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:18px; pointer-events:none;">🔍</span><button id="searchClear" style="position:absolute; right:14px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:var(--text-sub); font-size:20px; display:none;">✕</button></div><div id="searchMeta" style="font-size:13px; color:var(--text-sub); font-weight:500; margin-bottom:4px; min-height:20px;"></div></div><div id="searchResults" style="margin-top:12px;"></div>';

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
    clearBtn.style.display = query ? '' : 'none';
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
      results.innerHTML = '<div class="card"><div class="empty-state" style="padding:48px 24px;"><div class="empty-state-icon">🔍</div><div class="empty-state-title">未找到相关题目</div><div class="empty-state-desc">请尝试其他关键词</div></div></div>';
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
          <button class="btn btn-sm quiz-bookmark-btn ${isBm ? 'bookmarked' : ''} search-bm-btn" data-id="${escAttr(q.id)}" title="${isBm ? '取消收藏' : '收藏此题'}">${isBm ? '⭐' : '☆'}</button>
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
        if (bi >= 0) { bookmarks.splice(bi, 1); this.textContent = '☆'; this.classList.remove('bookmarked'); this.title='收藏此题'; }
        else { bookmarks.push(qId); this.textContent = '⭐'; this.classList.add('bookmarked'); this.title='取消收藏'; }
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
  const totalMulti = questionBank.filter(q => q.type === 'multi').length;
  const totalFill = questionBank.filter(q => q.type === 'fill').length;

  container.innerHTML = `
    <div class="card">
      <h2 style="font-size:20px; font-weight:700; margin-bottom:20px;">模拟考试配置</h2>

      <div style="margin-bottom:24px">
        <p style="margin-bottom:12px; font-weight:600">选择章节：</p>
        <div id="examChapters" class="exam-chapter-grid">
          ${chapters.map(ch => {
            const single = questionBank.filter(q => q.chapter === ch && q.type === 'single').length;
            const multi = questionBank.filter(q => q.chapter === ch && q.type === 'multi').length;
            const fill = questionBank.filter(q => q.chapter === ch && q.type === 'fill').length;
            return `<label class="exam-chapter-card selected">
              <input type="checkbox" value="${escAttr(ch)}" class="exam-chk" checked>
              <div class="exam-chapter-card-body">
                <div class="exam-chapter-card-name">${esc(ch)}</div>
                <div class="exam-chapter-card-count">单选 ${single} · 多选 ${multi} · 填空 ${fill}</div>
              </div>
            </label>`;
          }).join('')}
        </div>
        <div style="margin-top:14px; display:flex; gap:8px;">
          <button class="btn btn-sm" id="btnSelectAll">全选</button>
          <button class="btn btn-sm" id="btnDeselectAll">取消全选</button>
        </div>
      </div>

      <div class="exam-count-row">
        <div class="exam-count-item">
          <div class="exam-count-label">单选题数</div>
          <input type="number" class="exam-count-input" id="examSingleCount" value="${Math.min(10, totalSingle)}" min="0" max="${totalSingle}">
          <div class="exam-count-sub">最多可选 ${totalSingle} 题</div>
        </div>
        <div class="exam-count-item">
          <div class="exam-count-label">多选题数</div>
          <input type="number" class="exam-count-input" id="examMultiCount" value="${Math.min(5, totalMulti)}" min="0" max="${totalMulti}">
          <div class="exam-count-sub">最多可选 ${totalMulti} 题</div>
        </div>
        <div class="exam-count-item">
          <div class="exam-count-label">填空题数</div>
          <input type="number" class="exam-count-input" id="examFillCount" value="${Math.min(5, totalFill)}" min="0" max="${totalFill}">
          <div class="exam-count-sub">最多可选 ${totalFill} 题</div>
        </div>
      </div>

      <p style="color:var(--text-sub); font-size:13px; margin-bottom:20px; font-weight:500;">
        题库共有：单选 <strong>${totalSingle}</strong> 题 · 多选 <strong>${totalMulti}</strong> 题 · 填空 <strong>${totalFill}</strong> 题
        <span id="availableHint"></span>
      </p>

      <button class="btn btn-primary" id="btnStartExam" style="min-width:160px; padding:14px 28px; font-size:16px;">🚀 开始考试</button>
    </div>
  `;

  function updateHint() {
    const selectedChs = [...document.querySelectorAll('.exam-chk:checked')].map(cb => cb.value);
    const availSingle = questionBank.filter(q => selectedChs.includes(q.chapter) && q.type === 'single').length;
    const availMulti = questionBank.filter(q => selectedChs.includes(q.chapter) && q.type === 'multi').length;
    const availFill = questionBank.filter(q => selectedChs.includes(q.chapter) && q.type === 'fill').length;
    const hint = $id('availableHint');
    if (hint) hint.textContent = ` · 已选章节可用：单选 ${availSingle} 题 · 多选 ${availMulti} 题 · 填空 ${availFill} 题`;
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

  $id('btnStartExam').addEventListener('click', () => {
    const selectedChs = [...document.querySelectorAll('.exam-chk:checked')].map(cb => cb.value);
    if (selectedChs.length === 0) { alert('请至少选择一个章节'); return; }

    const singleCount = parseInt($id('examSingleCount').value) || 0;
    const multiCount = parseInt($id('examMultiCount').value) || 0;
    const fillCount = parseInt($id('examFillCount').value) || 0;
    if (singleCount === 0 && multiCount === 0 && fillCount === 0) { alert('请至少设置一种题型的数量'); return; }

    const poolSingle = shuffle(questionBank.filter(q => selectedChs.includes(q.chapter) && q.type === 'single'));
    const poolMulti = shuffle(questionBank.filter(q => selectedChs.includes(q.chapter) && q.type === 'multi'));
    const poolFill = shuffle(questionBank.filter(q => selectedChs.includes(q.chapter) && q.type === 'fill'));

    if (singleCount > poolSingle.length) {
      alert(`单选题不足！需要 ${singleCount} 题，但只有 ${poolSingle.length} 题可用`);
      return;
    }
    if (multiCount > poolMulti.length) {
      alert(`多选题不足！需要 ${multiCount} 题，但只有 ${poolMulti.length} 题可用`);
      return;
    }
    if (fillCount > poolFill.length) {
      alert(`填空题不足！需要 ${fillCount} 题，但只有 ${poolFill.length} 题可用`);
      return;
    }

    const examQuestions = shuffle([
      ...poolSingle.slice(0, singleCount),
      ...poolMulti.slice(0, multiCount),
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

function getChapters() {
  return [...new Set(questionBank.map(q => q.chapter))].sort();
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
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
    `;
    btn.setAttribute('title', '切换至亮色模式');
  } else {
    document.body.classList.remove('dark');
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    `;
    btn.setAttribute('title', '切换至暗色模式');
  }
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
  renderPage();
}

initApp();
