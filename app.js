"use strict";

const BANK = window.QUESTION_BANK;
const STORAGE_KEY = "maogai-quiz-data-v1";
const THEME_KEY = "maogai-theme";
const DAY_TARGET = 10;
const MAX_ATTEMPTS = 7000;
const MAX_HISTORY = 100;

if (!BANK || !Array.isArray(BANK.questions)) {
  throw new Error("题库加载失败，请确认 questions.js 与 index.html 位于同一目录。");
}

const QUESTION_MAP = new Map(BANK.questions.map((question) => [question.id, question]));
const CHAPTER_MAP = new Map(BANK.chapters.map((chapter) => [chapter.id, chapter]));
const TYPE_OPTIONS = ["单选题", "多选题", "判断题"];
const ORDER_LABELS = { sequence: "顺序刷题", random: "乱序刷题" };
const TYPE_LABELS = { all: "全部题型", 单选题: "单选题", 多选题: "多选题", 判断题: "判断题" };

const main = document.getElementById("main");
const themeToggle = document.getElementById("theme-toggle");
const sessionShortcut = document.getElementById("session-shortcut");
const toastEl = document.getElementById("toast");
const importInput = document.getElementById("import-file");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

const ui = {
  composer: {
    chapterId: "all",
    order: "sequence",
    count: "10",
    type: "all",
  },
  wrongFilter: "all",
  wrongOrder: "sequence",
  expandedWrongId: null,
  pendingSelections: {},
  toastTimer: null,
  timer: null,
};

let data = loadData();

function createDefaultData() {
  return {
    version: 1,
    attempts: [],
    wrongBook: {},
    history: [],
    activeSession: null,
    updatedAt: new Date().toISOString(),
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultData();
    return normalizeData(JSON.parse(raw));
  } catch (error) {
    console.warn("无法读取本地练习记录：", error);
    return createDefaultData();
  }
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeSession(rawSession) {
  if (!rawSession || typeof rawSession !== "object") return null;
  const questionIds = Array.isArray(rawSession.questionIds)
    ? [...new Set(rawSession.questionIds.filter((id) => QUESTION_MAP.has(id)))]
    : [];
  if (!questionIds.length) return null;

  const answers = {};
  if (rawSession.answers && typeof rawSession.answers === "object") {
    for (const questionId of questionIds) {
      const answer = rawSession.answers[questionId];
      if (!answer || !Array.isArray(answer.selected)) continue;
      answers[questionId] = {
        selected: answer.selected.map(String).filter((key) => /^[A-E]$/.test(key)),
        correct: Boolean(answer.correct),
        submittedAt: String(answer.submittedAt || new Date().toISOString()),
      };
    }
  }

  const currentIndex = Math.min(
    Math.max(0, Math.floor(normalizeNumber(rawSession.currentIndex, 0))),
    questionIds.length - 1,
  );
  const createdAt = String(rawSession.createdAt || new Date().toISOString());
  const completedAt = rawSession.completedAt ? String(rawSession.completedAt) : null;
  const chapterId =
    rawSession.chapterId === "all" || CHAPTER_MAP.has(rawSession.chapterId)
      ? rawSession.chapterId
      : "all";
  const type = ["all", ...TYPE_OPTIONS].includes(rawSession.type) ? rawSession.type : "all";
  const order = rawSession.order === "random" ? "random" : "sequence";
  const source = rawSession.source === "wrong" ? "wrong" : "chapter";

  return {
    id: String(rawSession.id || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    createdAt,
    startedAt: String(rawSession.startedAt || createdAt),
    completedAt,
    chapterId,
    chapterTitle:
      source === "wrong"
        ? "历史错题"
        : chapterId === "all"
          ? "全部章节"
          : CHAPTER_MAP.get(chapterId)?.title || "全部章节",
    type,
    order,
    source,
    requestedCount: String(rawSession.requestedCount || questionIds.length),
    questionIds,
    currentIndex,
    answers,
    summary: completedAt ? {
      total: questionIds.length,
      answered: Object.keys(answers).length,
      correct: Object.values(answers).filter((answer) => answer.correct).length,
      durationSeconds: normalizeNumber(rawSession.summary?.durationSeconds),
    } : null,
  };
}

function normalizeData(raw) {
  if (!raw || typeof raw !== "object") return createDefaultData();
  const clean = createDefaultData();

  if (Array.isArray(raw.attempts)) {
    clean.attempts = raw.attempts
      .filter((attempt) => attempt && QUESTION_MAP.has(attempt.questionId))
      .slice(-MAX_ATTEMPTS)
      .map((attempt) => ({
        id: String(attempt.id || `attempt-${attempt.questionId}-${attempt.answeredAt || Date.now()}`),
        sessionId: String(attempt.sessionId || ""),
        questionId: String(attempt.questionId),
        chapterId: String(attempt.chapterId || QUESTION_MAP.get(attempt.questionId).chapterId),
        selected: Array.isArray(attempt.selected)
          ? attempt.selected.map(String).filter((key) => /^[A-E]$/.test(key))
          : [],
        correct: Boolean(attempt.correct),
        answeredAt: String(attempt.answeredAt || new Date().toISOString()),
      }));
  }

  if (raw.wrongBook && typeof raw.wrongBook === "object") {
    for (const [questionId, entry] of Object.entries(raw.wrongBook)) {
      if (!QUESTION_MAP.has(questionId) || !entry || typeof entry !== "object") continue;
      clean.wrongBook[questionId] = {
        firstWrongAt: String(entry.firstWrongAt || new Date().toISOString()),
        lastWrongAt: String(entry.lastWrongAt || entry.firstWrongAt || new Date().toISOString()),
        wrongCount: Math.max(1, normalizeNumber(entry.wrongCount, 1)),
        lastSelected: Array.isArray(entry.lastSelected)
          ? entry.lastSelected.map(String).filter((key) => /^[A-E]$/.test(key))
          : [],
        correctStreak: normalizeNumber(entry.correctStreak),
        reviewCount: normalizeNumber(entry.reviewCount),
        masteredAt: entry.masteredAt ? String(entry.masteredAt) : null,
      };
    }
  }

  if (Array.isArray(raw.history)) {
    const seen = new Set();
    clean.history = raw.history
      .map(normalizeSession)
      .filter((session) => {
        if (!session || !session.completedAt || seen.has(session.id)) return false;
        seen.add(session.id);
        return true;
      })
      .slice(0, MAX_HISTORY);
  }

  clean.activeSession = normalizeSession(raw.activeSession);
  clean.updatedAt = String(raw.updatedAt || new Date().toISOString());
  return clean;
}

function saveData() {
  data.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("保存练习记录失败：", error);
    showToast("记录保存失败：浏览器存储空间可能已满");
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character],
  );
}

function icon(name, extraClass = "") {
  return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function getQuestion(questionId) {
  return QUESTION_MAP.get(questionId);
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDate(value, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  const options = withTime
    ? {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }
    : { month: "long", day: "numeric" };
  return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

function formatLongDate(value = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(value));
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(normalizeNumber(totalSeconds)));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function formatTimer(totalSeconds) {
  const seconds = Math.max(0, Math.floor(normalizeNumber(totalSeconds)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
  }
  return [minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

function correctKeys(question) {
  if (!question) return [];
  if (question.type === "判断题") {
    const match = question.options.find((option) => option.text === question.answer);
    return match ? [match.key] : [];
  }
  return [...question.answer].sort();
}

function isCorrectAnswer(question, selected) {
  const actual = [...new Set(selected)].sort().join("");
  const expected = correctKeys(question).sort().join("");
  return Boolean(expected) && actual === expected;
}

function answerText(question) {
  const keys = correctKeys(question);
  return keys
    .map((key) => {
      const option = question.options.find((item) => item.key === key);
      return option ? `${key}. ${option.text}` : key;
    })
    .join("；");
}

function selectedAnswerText(question, selected = []) {
  if (!selected.length) return "未作答";
  return selected
    .map((key) => {
      const option = question.options.find((item) => item.key === key);
      return option ? `${key}. ${option.text}` : key;
    })
    .join("；");
}

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function getOverallStats() {
  const correct = data.attempts.filter((attempt) => attempt.correct).length;
  const studyDays = new Set(data.attempts.map((attempt) => localDateKey(attempt.answeredAt))).size;
  const wrongEntries = Object.values(data.wrongBook);
  const pendingWrong = wrongEntries.filter((entry) => !entry.masteredAt).length;
  return {
    answered: data.attempts.length,
    correct,
    accuracy: percent(correct, data.attempts.length),
    studyDays,
    wrongTotal: wrongEntries.length,
    pendingWrong,
    masteredWrong: wrongEntries.length - pendingWrong,
    sessions: data.history.length,
  };
}

function getTodayStats() {
  const today = localDateKey(new Date());
  const attempts = data.attempts.filter((attempt) => localDateKey(attempt.answeredAt) === today);
  const correct = attempts.filter((attempt) => attempt.correct).length;
  return {
    answered: attempts.length,
    correct,
    accuracy: percent(correct, attempts.length),
    progress: Math.min(100, Math.round((attempts.length / DAY_TARGET) * 100)),
  };
}

function getChapterStats() {
  const stats = new Map(
    BANK.chapters.map((chapter) => [
      chapter.id,
      { seen: new Set(), attempts: 0, correct: 0 },
    ]),
  );
  for (const attempt of data.attempts) {
    const chapterStat = stats.get(attempt.chapterId);
    if (!chapterStat) continue;
    chapterStat.seen.add(attempt.questionId);
    chapterStat.attempts += 1;
    if (attempt.correct) chapterStat.correct += 1;
  }
  return stats;
}

function getSessionElapsed(session) {
  if (!session) return 0;
  const end = session.completedAt ? new Date(session.completedAt).getTime() : Date.now();
  const start = new Date(session.startedAt || session.createdAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

function getActiveSession() {
  return data.activeSession && QUESTION_MAP.has(data.activeSession.questionIds?.[0])
    ? data.activeSession
    : null;
}

function getCurrentQuestion() {
  const session = getActiveSession();
  if (!session) return null;
  return getQuestion(session.questionIds[session.currentIndex]);
}

function getSessionResult(session) {
  const answers = Object.values(session?.answers || {});
  const correct = answers.filter((answer) => answer.correct).length;
  return {
    total: session?.questionIds.length || 0,
    answered: answers.length,
    correct,
    wrong: answers.length - correct,
    unanswered: (session?.questionIds.length || 0) - answers.length,
    score: percent(correct, session?.questionIds.length || 0),
  };
}

function getPoolQuestions(chapterId, type) {
  return BANK.questions.filter(
    (question) =>
      (chapterId === "all" || question.chapterId === chapterId) &&
      (type === "all" || question.type === type),
  );
}

function getComposerSummary() {
  const pool = getPoolQuestions(ui.composer.chapterId, ui.composer.type);
  const requestedCount =
    ui.composer.count === "all" ? pool.length : Math.min(Number(ui.composer.count), pool.length);
  const chapter =
    ui.composer.chapterId === "all"
      ? "全部章节"
      : CHAPTER_MAP.get(ui.composer.chapterId)?.title || "全部章节";
  return {
    chapter,
    count: requestedCount,
    poolSize: pool.length,
    text: `${chapter} · ${TYPE_LABELS[ui.composer.type]} · ${
      ORDER_LABELS[ui.composer.order]
    }`,
  };
}

function activeSessionStrip() {
  const session = getActiveSession();
  if (!session) return "";

  const answered = Object.keys(session.answers).length;
  const total = session.questionIds.length;
  if (session.completedAt) {
    return `
      <div class="active-strip">
        <div class="active-strip-copy">
          <span class="active-strip-icon">${icon("award")}</span>
          <div>
            <strong>上一组练习已完成</strong>
            <span>${escapeHTML(session.chapterTitle)} · 正确率 ${getSessionResult(session).score}%</span>
          </div>
        </div>
        <button class="button button-secondary" type="button" data-action="resume-session">
          查看结果
        </button>
      </div>
    `;
  }

  return `
    <div class="active-strip">
      <div class="active-strip-copy">
        <span class="active-strip-icon">${icon("play")}</span>
        <div>
          <strong>上次练习还没做完</strong>
          <span>${escapeHTML(session.chapterTitle)} · 已完成 ${answered} / ${total} 题</span>
        </div>
      </div>
      <button class="button button-secondary" type="button" data-action="resume-session">
        继续练习
      </button>
    </div>
  `;
}

function renderHome() {
  const today = getTodayStats();
  const overall = getOverallStats();
  const chapterStats = getChapterStats();
  const composerSummary = getComposerSummary();
  const chapterOptions = [
    `<option value="all"${ui.composer.chapterId === "all" ? " selected" : ""}>全部章节 · ${BANK.total} 题</option>`,
    ...BANK.chapters.map(
      (chapter) =>
        `<option value="${escapeHTML(chapter.id)}"${
          ui.composer.chapterId === chapter.id ? " selected" : ""
        }>${escapeHTML(chapter.title)} · ${chapter.count} 题</option>`,
    ),
  ].join("");

  const chapterCards = BANK.chapters
    .map((chapter, index) => {
      const stats = chapterStats.get(chapter.id);
      const seen = stats.seen.size;
      const chapterProgress = Math.round((seen / chapter.count) * 100);
      const accuracy = percent(stats.correct, stats.attempts);
      const indexLabel = index === 0 ? "序" : String(index).padStart(2, "0");
      return `
        <button
          class="chapter-card"
          type="button"
          data-action="choose-chapter"
          data-chapter="${escapeHTML(chapter.id)}"
        >
          <span class="chapter-card-top">
            <span class="chapter-index">${indexLabel}</span>
            <span class="chapter-count">${chapter.count} 题</span>
          </span>
          <h3>${escapeHTML(chapter.title)}</h3>
          <span class="chapter-progress">
            <span class="chapter-progress-meta">
              <span>已练 ${seen} / ${chapter.count}</span>
              <span>${stats.attempts ? `正确率 ${accuracy}%` : "尚未开始"}</span>
            </span>
            <span class="mini-progress"><span style="width:${chapterProgress}%"></span></span>
          </span>
        </button>
      `;
    })
    .join("");

  const countOptions = ["10", "20", "30", "all"]
    .map((count) => {
      const label =
        count === "all"
          ? `全部 ${composerSummary.poolSize}`
          : String(Math.min(Number(count), composerSummary.poolSize));
      return `
        <button
          class="pick-chip${ui.composer.count === count ? " is-active" : ""}"
          type="button"
          data-action="set-composer-count"
          data-value="${count}"
          aria-pressed="${ui.composer.count === count}"
        >${label}</button>
      `;
    })
    .join("");

  const typeOptions = ["all", ...TYPE_OPTIONS]
    .map(
      (type) => `
        <button
          class="pick-chip${ui.composer.type === type ? " is-active" : ""}"
          type="button"
          data-action="set-composer-type"
          data-value="${type}"
          aria-pressed="${ui.composer.type === type}"
        >${TYPE_LABELS[type]}</button>
      `,
    )
    .join("");

  return `
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-content">
        <span class="hero-kicker">${icon("spark")}${escapeHTML(formatLongDate())} · 保持研习</span>
        <h1 id="hero-title">把理论，<em>练成直觉。</em></h1>
        <p class="hero-description">
          从绪论到科学发展观，按章节推进或随机自测。每次作答即时核对答案与解析，错题会留下记录，随时回炉。
        </p>
        <div class="hero-actions">
          <button class="button button-dark button-large" type="button" data-action="focus-builder">
            ${icon("book")}开始一组练习
          </button>
          <button class="button button-outline-light button-large" type="button" data-action="route-wrong">
            ${icon("refresh")}回看错题
          </button>
        </div>
        <span class="hero-note">${icon("check")}进度自动保存，刷新页面也不会丢失</span>
      </div>
      <aside class="today-panel" aria-label="今日练习情况">
        <div class="today-panel-head">
          <span>今日研习</span>
          <small>目标 ${DAY_TARGET} 题</small>
        </div>
        <div class="today-progress">
          <div class="progress-ring" style="--progress:${today.progress}">
            <div class="progress-ring-copy">
              <strong>${today.progress}%</strong>
              <small>今日进度</small>
            </div>
          </div>
          <div class="today-count">
            <strong>${today.answered}</strong>
            <span>题已作答</span>
          </div>
        </div>
        <div class="today-divider"></div>
        <div class="today-metrics">
          <div><span>今日正确率</span><strong>${today.answered ? `${today.accuracy}%` : "—"}</strong></div>
          <div><span>待复习错题</span><strong>${overall.pendingWrong}</strong></div>
        </div>
      </aside>
    </section>

    ${activeSessionStrip()}

    <section class="overview-strip" aria-label="题库概览">
      <div class="overview-item"><span>完整题库</span><strong>${BANK.total}<small>题</small></strong></div>
      <div class="overview-item"><span>章节覆盖</span><strong>${BANK.chapters.length}<small>章</small></strong></div>
      <div class="overview-item"><span>累计作答</span><strong>${overall.answered}<small>次</small></strong></div>
      <div class="overview-item"><span>总体正确率</span><strong>${overall.answered ? `${overall.accuracy}%` : "—"}</strong></div>
    </section>

    <section class="section-block" id="practice-builder">
      <div class="section-head">
        <div class="section-head-copy">
          <span class="section-number">01</span>
          <div>
            <h2>开始一次研习</h2>
            <p>选择题库范围，决定刷题顺序。</p>
          </div>
        </div>
      </div>
      <div class="builder">
        <div class="builder-top">
          <div>
            <strong>本次练习配置</strong>
            <span>作答后可查看正确答案与解析</span>
          </div>
          <span class="builder-status">自动保存进度</span>
        </div>
        <div class="builder-body">
          <label class="builder-field">
            <span class="field-label">${icon("book")}练习章节</span>
            <span class="select-wrap">
              <select data-field="composer-chapter" aria-label="选择练习章节">
                ${chapterOptions}
              </select>
              ${icon("chevron-down")}
            </span>
          </label>
          <div class="builder-field">
            <span class="field-label">${icon("list")}刷题顺序</span>
            <div class="segmented" aria-label="选择刷题顺序">
              <button
                type="button"
                data-action="set-composer-order"
                data-value="sequence"
                class="${ui.composer.order === "sequence" ? "is-active" : ""}"
                aria-pressed="${ui.composer.order === "sequence"}"
              >${icon("list")}顺序</button>
              <button
                type="button"
                data-action="set-composer-order"
                data-value="random"
                class="${ui.composer.order === "random" ? "is-active" : ""}"
                aria-pressed="${ui.composer.order === "random"}"
              >${icon("shuffle")}乱序</button>
            </div>
          </div>
          <div class="builder-field">
            <span class="field-label">${icon("target")}本组题量</span>
            <div class="pick-row" aria-label="选择本组题量">${countOptions}</div>
          </div>
          <div class="builder-field builder-field-wide">
            <div class="builder-wide-row">
              <div>
                <span class="field-label">${icon("spark")}题型范围</span>
                <div class="pick-row" aria-label="选择题型">${typeOptions}</div>
              </div>
              <div class="builder-start">
                <span class="builder-start-copy">
                  <strong id="builder-summary">${escapeHTML(composerSummary.text)}</strong>
                  共 ${composerSummary.count} 题
                </span>
                <button class="button button-primary button-large" type="button" data-action="start-composer">
                  ${icon("arrow-right")}开始刷题
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section-block">
      <div class="section-head">
        <div class="section-head-copy">
          <span class="section-number">02</span>
          <div>
            <h2>按章节推进</h2>
            <p>点击任一章节，快速带入上方练习配置。</p>
          </div>
        </div>
        <button class="text-button" type="button" data-action="route-wrong">
          查看错题本 ${icon("arrow-right")}
        </button>
      </div>
      <div class="chapter-grid">${chapterCards}</div>
    </section>
  `;
}

function emptyState({ iconName = "book", title, copy, action = "" }) {
  return `
    <div class="empty-state">
      <span class="empty-icon">${icon(iconName)}</span>
      <h2>${escapeHTML(title)}</h2>
      <p>${escapeHTML(copy)}</p>
      ${action}
    </div>
  `;
}

function getFilteredWrongEntries() {
  return Object.entries(data.wrongBook)
    .map(([questionId, entry]) => ({ question: getQuestion(questionId), entry, questionId }))
    .filter(({ question, entry }) => {
      if (!question) return false;
      if (ui.wrongFilter === "pending") return !entry.masteredAt;
      if (ui.wrongFilter === "mastered") return Boolean(entry.masteredAt);
      return true;
    })
    .sort(
      (first, second) =>
        new Date(second.entry.lastWrongAt).getTime() -
        new Date(first.entry.lastWrongAt).getTime(),
    );
}

function renderWrongCard({ question, entry, questionId }, index) {
  const expanded = ui.expandedWrongId === questionId;
  const mastered = Boolean(entry.masteredAt);
  return `
    <article class="wrong-item${expanded ? " is-open" : ""}">
      <button
        class="wrong-item-toggle"
        type="button"
        data-action="toggle-wrong"
        data-question="${escapeHTML(questionId)}"
        aria-expanded="${expanded}"
        aria-controls="wrong-detail-${escapeHTML(questionId)}"
      >
        <span class="wrong-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="wrong-main">
          <strong>${escapeHTML(question.stem)}</strong>
          <span>${escapeHTML(question.chapter)} · 错 ${entry.wrongCount} 次 · ${escapeHTML(
            formatDate(entry.lastWrongAt),
          )}记录</span>
        </span>
        <span class="wrong-side">
          <span class="mastery-badge${mastered ? " mastered" : ""}">${
            mastered ? "已掌握" : "待复习"
          }</span>
          ${icon("chevron-down", "wrong-chevron")}
        </span>
      </button>
      ${
        expanded
          ? `
            <div class="wrong-detail" id="wrong-detail-${escapeHTML(questionId)}">
              <div class="wrong-detail-answer">
                正确答案：<strong>${escapeHTML(answerText(question))}</strong>
              </div>
              <div class="analysis">
                <div class="analysis-label">${icon("spark")}答案解析</div>
                ${escapeHTML(question.analysis)}
              </div>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderWrongBook() {
  const overall = getOverallStats();
  const entries = getFilteredWrongEntries();
  const totalWrong = overall.wrongTotal;
  const filterButtons = [
    ["all", `全部 ${totalWrong}`],
    ["pending", `待复习 ${overall.pendingWrong}`],
    ["mastered", `已掌握 ${overall.masteredWrong}`],
  ]
    .map(
      ([value, label]) => `
        <button
          type="button"
          data-action="set-wrong-filter"
          data-value="${value}"
          class="${ui.wrongFilter === value ? "is-active" : ""}"
          aria-pressed="${ui.wrongFilter === value}"
        >${label}</button>
      `,
    )
    .join("");

  let content;
  if (!totalWrong) {
    content = emptyState({
      iconName: "award",
      title: "错题本还是空的",
      copy: "开始练习后，答错的题目会自动收进这里。之后的重练结果也会持续记录。",
      action:
        '<button class="button button-primary" type="button" data-action="route-home">去刷题</button>',
    });
  } else if (!entries.length) {
    content = emptyState({
      iconName: "check",
      title: ui.wrongFilter === "mastered" ? "还没有已掌握错题" : "没有待复习错题",
      copy:
        ui.wrongFilter === "mastered"
          ? "重练并答对一道历史错题后，它会在这里显示为已掌握。"
          : "当前错题均已掌握。你也可以切换筛选，继续回看。",
      action:
        '<button class="button button-secondary" type="button" data-action="set-wrong-filter" data-value="all">查看全部错题</button>',
    });
  } else {
    content = `<div class="wrong-list">${entries
      .map((entry, index) => renderWrongCard(entry, index))
      .join("")}</div>`;
  }

  return `
    <section class="page-heading">
      <div>
        <span class="eyebrow">Mistake Review</span>
        <h1>错题本</h1>
        <p>原题会一直保留。答错时记录原因，重练答对后标记为已掌握，不会被悄悄删除。</p>
      </div>
      <div class="page-heading-actions">
        <button class="button button-secondary" type="button" data-action="route-history">
          ${icon("clock")}查看练习记录
        </button>
      </div>
    </section>

    <section class="history-summary" aria-label="错题概况">
      <div class="summary-card">
        <div class="summary-card-top"><span>历史错题</span>${icon("note")}</div>
        <strong>${overall.wrongTotal}</strong>
        <small>道曾答错的题目</small>
      </div>
      <div class="summary-card">
        <div class="summary-card-top"><span>待复习</span>${icon("refresh")}</div>
        <strong>${overall.pendingWrong}</strong>
        <small>仍建议回看</small>
      </div>
      <div class="summary-card">
        <div class="summary-card-top"><span>已掌握</span>${icon("check")}</div>
        <strong>${overall.masteredWrong}</strong>
        <small>重练后答对</small>
      </div>
      <div class="summary-card">
        <div class="summary-card-top"><span>错题正确率</span>${icon("chart")}</div>
        <strong>${overall.answered ? `${overall.accuracy}%` : "—"}</strong>
        <small>综合全部作答</small>
      </div>
    </section>

    ${
      totalWrong
        ? `
          <div class="wrong-toolbar">
            <div class="filter-tabs" aria-label="筛选错题">${filterButtons}</div>
            <div class="toolbar-actions">
              <div class="compact-segment" aria-label="错题重练顺序">
                <button
                  type="button"
                  data-action="set-wrong-order"
                  data-value="sequence"
                  class="${ui.wrongOrder === "sequence" ? "is-active" : ""}"
                  aria-pressed="${ui.wrongOrder === "sequence"}"
                >顺序</button>
                <button
                  type="button"
                  data-action="set-wrong-order"
                  data-value="random"
                  class="${ui.wrongOrder === "random" ? "is-active" : ""}"
                  aria-pressed="${ui.wrongOrder === "random"}"
                >乱序</button>
              </div>
              <button class="button button-secondary" type="button" data-action="start-wrong" data-count="10">
                重练 10 道
              </button>
              <button class="button button-primary" type="button" data-action="start-wrong" data-count="all">
                重练当前错题
              </button>
            </div>
          </div>
        `
        : ""
    }

    ${content}
  `;
}

function getLastSevenDays() {
  const days = [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(todayStart);
    date.setDate(todayStart.getDate() - offset);
    const key = localDateKey(date);
    const attempts = data.attempts.filter((attempt) => localDateKey(attempt.answeredAt) === key);
    days.push({
      date,
      key,
      answered: attempts.length,
      correct: attempts.filter((attempt) => attempt.correct).length,
    });
  }
  return days;
}

function renderWeekChart(days) {
  const max = Math.max(1, ...days.map((day) => day.answered));
  const labels = ["日", "一", "二", "三", "四", "五", "六"];
  const accessible = days
    .map((day) => `${formatDate(day.date)} ${day.answered} 题`)
    .join("，");
  return `
    <div class="week-chart" role="img" aria-label="最近七天答题量：${escapeHTML(accessible)}">
      ${days
        .map((day) => {
          const height = day.answered ? Math.max(6, Math.round((day.answered / max) * 100)) : 2;
          return `
            <div class="week-day">
              <div class="week-bar-track">
                <span
                  class="week-bar${day.answered ? "" : " is-empty"}"
                  style="height:${height}%"
                ></span>
              </div>
              <span class="week-value">${day.answered}</span>
              <span class="week-label">周${labels[day.date.getDay()]}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSessionRow(session) {
  const result = getSessionResult(session);
  const sessionDate = new Date(session.completedAt || session.createdAt);
  const day = String(sessionDate.getDate()).padStart(2, "0");
  const month = `${sessionDate.getMonth() + 1}月`;
  const duration = session.summary?.durationSeconds || getSessionElapsed(session);
  return `
    <button class="session-row" type="button" data-action="open-session" data-id="${escapeHTML(session.id)}">
      <span class="session-date"><strong>${day}</strong><span>${month}</span></span>
      <span class="session-main">
        <strong>${escapeHTML(session.chapterTitle)}</strong>
        <span>${escapeHTML(TYPE_LABELS[session.type] || "全部题型")} · ${
          result.total
        } 题 · ${escapeHTML(formatDuration(duration))}</span>
      </span>
      <span class="session-mode">${escapeHTML(ORDER_LABELS[session.order])}<br />${escapeHTML(
        formatDate(session.completedAt || session.createdAt, true),
      )}</span>
      <span class="session-score"><strong>${result.score}%</strong><span>正确率</span></span>
      ${icon("arrow-right", "session-arrow")}
    </button>
  `;
}

function renderHistory() {
  const overall = getOverallStats();
  const days = getLastSevenDays();
  const activityTotal = days.reduce((total, day) => total + day.answered, 0);
  const history = data.history;

  return `
    <section class="page-heading">
      <div>
        <span class="eyebrow">Practice Archive</span>
        <h1>练习记录</h1>
        <p>每组练习的成绩、时长与逐题结果都保存在当前浏览器。你也可以导出备份，换设备继续使用。</p>
      </div>
      <div class="page-heading-actions history-actions">
        <button class="button button-secondary" type="button" data-action="export-data">
          ${icon("download")}导出记录
        </button>
        <button class="button button-secondary" type="button" data-action="import-data">
          ${icon("upload")}导入记录
        </button>
      </div>
    </section>

    <section class="history-summary" aria-label="累计练习概况">
      <div class="summary-card">
        <div class="summary-card-top"><span>累计作答</span>${icon("book")}</div>
        <strong>${overall.answered}</strong>
        <small>次答题记录</small>
      </div>
      <div class="summary-card">
        <div class="summary-card-top"><span>总体正确率</span>${icon("target")}</div>
        <strong>${overall.answered ? `${overall.accuracy}%` : "—"}</strong>
        <small>${overall.correct} 次答对</small>
      </div>
      <div class="summary-card">
        <div class="summary-card-top"><span>完成练习</span>${icon("award")}</div>
        <strong>${overall.sessions}</strong>
        <small>组练习记录</small>
      </div>
      <div class="summary-card">
        <div class="summary-card-top"><span>研习天数</span>${icon("clock")}</div>
        <strong>${overall.studyDays}</strong>
        <small>个有作答的日期</small>
      </div>
    </section>

    <section class="activity-panel" aria-label="最近七天学习活动">
      <div class="activity-copy">
        <span class="eyebrow">Last 7 Days</span>
        <h2>最近七天</h2>
        <p>共完成 ${activityTotal} 次作答。柱子越高，说明当天练得越多。</p>
      </div>
      ${renderWeekChart(days)}
    </section>

    <div class="history-toolbar">
      <div>
        <strong style="font-size: 14px">全部练习</strong>
        <span style="margin-left: 8px; color: var(--muted); font-size: 11px">${
          history.length
        } 组</span>
      </div>
      <div class="toolbar-actions">
        <span style="color: var(--muted); font-size: 11px">记录保存在本机</span>
        <button class="button button-ghost" type="button" data-action="clear-data">
          ${icon("trash")}清空全部记录
        </button>
      </div>
    </div>

    ${
      history.length
        ? `<div class="session-list">${history.map(renderSessionRow).join("")}</div>`
        : emptyState({
            iconName: "chart",
            title: "还没有完成的练习",
            copy: "完成第一组题目后，这里会记录成绩、用时和每道题的作答结果。",
            action:
              '<button class="button button-primary" type="button" data-action="route-home">开始第一组</button>',
          })
    }
  `;
}

function getPendingSelection(session, question) {
  if (!session || !question) return [];
  if (!ui.pendingSelections[session.id]) ui.pendingSelections[session.id] = {};
  return ui.pendingSelections[session.id][question.id] || [];
}

function renderOption(question, option, submittedAnswer) {
  const submitted = Boolean(submittedAnswer);
  const selected = submitted
    ? submittedAnswer.selected
    : getPendingSelection(getActiveSession(), question);
  const expected = correctKeys(question);
  const isSelected = selected.includes(option.key);
  const isExpected = expected.includes(option.key);

  let className = "option";
  let mark = "";
  if (submitted) {
    if (isExpected) {
      className += " is-correct";
      mark = icon("check");
    } else if (isSelected) {
      className += " is-wrong";
      mark = icon("x");
    } else {
      className += " is-faded";
    }
  } else if (isSelected) {
    className += " is-selected";
  }

  return `
    <button
      class="${className}"
      type="button"
      data-action="select-option"
      data-key="${escapeHTML(option.key)}"
      aria-pressed="${isSelected}"
      ${submitted ? "disabled" : ""}
    >
      <span class="option-key">${escapeHTML(option.key)}</span>
      <span class="option-text">${escapeHTML(option.text)}</span>
      <span class="option-mark">${mark}</span>
    </button>
  `;
}

function renderReviewPanel(question, answer) {
  const isCorrect = answer.correct;
  return `
    <section class="review-panel ${isCorrect ? "correct" : "incorrect"}" aria-live="polite">
      <div class="review-feedback">
        <span class="feedback-icon">${icon(isCorrect ? "check" : "x")}</span>
        <div>
          <strong>${isCorrect ? "回答正确" : "回答错误，已收入错题本"}</strong>
          <span>${
            isCorrect
              ? "判断准确，继续下一题。"
              : `你选择了 ${escapeHTML(answer.selected.join("、")) || "无"}，正确答案是 ${escapeHTML(
                  correctKeys(question).join("、"),
                )}。`
          }</span>
        </div>
      </div>
      <div class="review-body">
        <div class="answer-line">
          <span>正确答案</span>
          <strong>${escapeHTML(answerText(question))}</strong>
        </div>
        <div class="analysis">
          <div class="analysis-label">${icon("spark")}答案解析</div>
          ${escapeHTML(question.analysis)}
        </div>
      </div>
    </section>
  `;
}

function renderPractice() {
  const session = getActiveSession();
  if (!session) {
    return emptyState({
      iconName: "book",
      title: "还没有进行中的练习",
      copy: "回到首页选择章节和顺序，开始一组新的练习。",
      action:
        '<button class="button button-primary" type="button" data-action="route-home">返回首页</button>',
    });
  }

  const question = getQuestion(session.questionIds[session.currentIndex]);
  if (!question) {
    return emptyState({
      iconName: "x",
      title: "题目加载失败",
      copy: "当前练习中的题目已失效，请返回首页重新开始。",
      action:
        '<button class="button button-primary" type="button" data-action="route-home">返回首页</button>',
    });
  }

  const answer = session.answers[question.id] || null;
  const selected = answer ? answer.selected : getPendingSelection(session, question);
  const answeredCount = Object.keys(session.answers).length;
  const progress = percent(answeredCount, session.questionIds.length);
  const currentNumber = session.currentIndex + 1;
  const isLast = currentNumber === session.questionIds.length;
  const isMultiple = question.type === "多选题";

  return `
    <section class="practice-view">
      <div class="practice-toolbar">
        <button class="back-button" type="button" data-action="exit-practice">
          ${icon("arrow-left")}退出练习
        </button>
        <div class="practice-meta-right">
          <span class="timer">${icon("clock")}<span data-session-timer>${escapeHTML(
            formatTimer(getSessionElapsed(session)),
          )}</span></span>
          <span>${escapeHTML(ORDER_LABELS[session.order])}</span>
        </div>
      </div>

      <div class="practice-progress-card">
        <div>
          <div class="practice-progress-copy">
            <strong>第 ${currentNumber} / ${session.questionIds.length} 题</strong>
            <span>已答 ${answeredCount} 题 · ${escapeHTML(session.chapterTitle)}</span>
          </div>
          <div
            class="practice-progress-track"
            role="progressbar"
            aria-label="本组练习进度"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${progress}"
          ><span style="width:${progress}%"></span></div>
        </div>
        <span class="practice-percent">${progress}%</span>
      </div>

      <article class="question-card">
        <div class="question-meta">
          <span class="meta-pill type">${escapeHTML(question.type)}</span>
          <span class="meta-pill number">题库 ${String(question.number).padStart(3, "0")}</span>
          <span class="meta-pill chapter">${escapeHTML(question.chapter)}</span>
        </div>
        <h1 class="question-stem">${escapeHTML(question.stem)}</h1>
        ${
          isMultiple
            ? `<p class="question-hint">${icon("check")}本题为多选题，可选择多个选项后提交</p>`
            : ""
        }
        <div class="options${question.type === "判断题" ? " is-judgment" : ""}">
          ${question.options.map((option) => renderOption(question, option, answer)).join("")}
        </div>

        ${
          answer
            ? `
              ${renderReviewPanel(question, answer)}
              <div class="review-navigation">
                ${
                  session.currentIndex > 0
                    ? `<button class="button button-secondary" type="button" data-action="previous-question">
                        ${icon("arrow-left")}上一题
                      </button>`
                    : ""
                }
                <button class="button button-primary" type="button" data-action="next-question">
                  ${isLast ? "查看本组结果" : "下一题"}${icon("arrow-right")}
                </button>
              </div>
            `
            : `
              <div class="question-actions">
                <button
                  class="button button-primary"
                  type="button"
                  data-action="submit-answer"
                  ${selected.length ? "" : "disabled"}
                >
                  提交作答${icon("arrow-right")}
                </button>
              </div>
            `
        }
      </article>
    </section>
  `;
}

function renderResult() {
  const session = getActiveSession();
  if (!session || !session.completedAt) {
    return emptyState({
      iconName: "chart",
      title: "暂无可查看的结果",
      copy: "请先完成一组练习，或从练习记录中打开历史成绩。",
      action:
        '<button class="button button-primary" type="button" data-action="route-home">返回首页</button>',
    });
  }

  const result = getSessionResult(session);
  const duration = session.summary?.durationSeconds || getSessionElapsed(session);
  const headline =
    result.score >= 90 ? "稳稳拿下" : result.score >= 60 ? "渐入佳境" : "再盘一遍";
  const description =
    result.score >= 90
      ? "这一组掌握得很扎实，错题也已经替你留好。"
      : result.score >= 60
        ? "基础已经立住，回看本组错题会更稳。"
        : "先别急着赶进度，把本组解析读一遍再继续。";

  const questionRows = session.questionIds
    .map((questionId, index) => {
      const question = getQuestion(questionId);
      const answer = session.answers[questionId];
      if (!question) return "";
      const correct = Boolean(answer?.correct);
      return `
        <div class="result-question${correct ? "" : " is-wrong"}">
          <span class="result-question-number">${index + 1}</span>
          <span class="result-question-copy">
            <strong>${escapeHTML(question.stem)}</strong>
            <p>${
              correct
                ? "回答正确"
                : `正确答案：${escapeHTML(answerText(question))}`
            }</p>
          </span>
          <span class="result-question-status">${correct ? "正确" : "需复习"}</span>
        </div>
      `;
    })
    .join("");

  return `
    <section class="result-shell">
      <div class="result-hero">
        <div class="score-ring" style="--score:${result.score}">
          <div class="score-ring-inner">
            <strong>${result.score}<small style="font-size:18px">%</small></strong>
            <span>本组正确率</span>
          </div>
        </div>
        <div class="result-copy">
          <span class="eyebrow">Session Complete</span>
          <h1>${headline}</h1>
          <p>${description}</p>
          <div class="result-stats">
            <div class="result-stat"><span>答对</span><strong>${result.correct} / ${result.total}</strong></div>
            <div class="result-stat"><span>错题</span><strong>${result.wrong + result.unanswered}</strong></div>
            <div class="result-stat"><span>用时</span><strong>${escapeHTML(formatDuration(duration))}</strong></div>
          </div>
          <div class="result-actions">
            <button class="button button-light" type="button" data-action="route-home">
              ${icon("home")}返回首页
            </button>
            ${
              result.wrong || result.unanswered
                ? `<button class="button button-outline-light" type="button" data-action="practice-result-wrong">
                    ${icon("refresh")}本组错题重练
                  </button>`
                : ""
            }
            <button class="button button-outline-light" type="button" data-action="retry-session">
              ${icon("shuffle")}再来一组
            </button>
          </div>
        </div>
      </div>

      <section class="result-review">
        <div class="result-review-head">
          <h2>本组复盘</h2>
          <span>${escapeHTML(session.chapterTitle)} · ${escapeHTML(
            ORDER_LABELS[session.order],
          )}</span>
        </div>
        <div class="result-question-list">${questionRows}</div>
      </section>
    </section>
  `;
}

function parseRoute() {
  const route = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  if (route === "wrong" || route === "history" || route === "practice" || route === "result") {
    return route;
  }
  return "home";
}

function navigate(view, { scroll = true } = {}) {
  const targetHash = view === "home" ? "#/" : `#/${view}`;
  if (window.location.hash === targetHash) {
    renderCurrentView({ scroll });
    return;
  }
  window.location.hash = targetHash;
}

function updateChrome(view) {
  document.body.dataset.view = view;
  document.querySelectorAll("[data-nav]").forEach((button) => {
    const active =
      button.dataset.nav === view ||
      (view === "practice" && button.dataset.nav === "home") ||
      (view === "result" && button.dataset.nav === "home");
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  const activeSession = getActiveSession();
  if (!activeSession || view === "practice" || view === "result") {
    sessionShortcut.innerHTML = "";
  } else {
    const answered = Object.keys(activeSession.answers).length;
    sessionShortcut.innerHTML = `
      <button type="button" data-action="resume-session" aria-label="${
        activeSession.completedAt ? "查看上次练习结果" : "继续上次练习"
      }">
        <span class="live-dot"></span>
        ${activeSession.completedAt ? "查看结果" : `继续 ${answered}/${activeSession.questionIds.length}`}
      </button>
    `;
  }

  const titles = {
    home: "毛概研习 · 章节刷题",
    wrong: "错题本 · 毛概研习",
    history: "练习记录 · 毛概研习",
    practice: "正在刷题 · 毛概研习",
    result: "练习结果 · 毛概研习",
  };
  document.title = titles[view];
}

function stopClock() {
  if (ui.timer) {
    window.clearInterval(ui.timer);
    ui.timer = null;
  }
}

function startClock() {
  stopClock();
  const session = getActiveSession();
  const timerEl = document.querySelector("[data-session-timer]");
  if (!session || !timerEl) return;
  timerEl.textContent = formatTimer(getSessionElapsed(session));
  ui.timer = window.setInterval(() => {
    const currentTimer = document.querySelector("[data-session-timer]");
    if (!currentTimer) {
      stopClock();
      return;
    }
    currentTimer.textContent = formatTimer(getSessionElapsed(session));
  }, 1000);
}

function renderCurrentView({ scroll = false } = {}) {
  stopClock();
  const view = parseRoute();
  const renderers = {
    home: renderHome,
    wrong: renderWrongBook,
    history: renderHistory,
    practice: renderPractice,
    result: renderResult,
  };
  main.innerHTML = renderers[view]();
  updateChrome(view);
  if (view === "practice") startClock();
  if (scroll) {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  requestAnimationFrame(() => {
    if (view === "practice") {
      const questionStem = document.querySelector(".question-stem");
      if (questionStem) questionStem.setAttribute("tabindex", "-1");
    }
  });
}

function redrawPractice() {
  main.innerHTML = renderPractice();
  updateChrome("practice");
  startClock();
}

function showToast(message) {
  if (ui.toastTimer) window.clearTimeout(ui.toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  ui.toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("is-visible");
  }, 2400);
}

function applyTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalized;
  try {
    localStorage.setItem(THEME_KEY, normalized);
  } catch {
    // Theme persistence is optional.
  }
  themeToggle.setAttribute(
    "aria-label",
    normalized === "dark" ? "切换到浅色模式" : "切换到深色模式",
  );
  themeToggle.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${
    normalized === "dark" ? "sun" : "moon"
  }"></use></svg>`;
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", normalized === "dark" ? "#181714" : "#b1362e");
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function createSession({
  chapterId = "all",
  order = "sequence",
  count = "10",
  type = "all",
  source = "chapter",
  customQuestionIds = null,
}) {
  let pool = customQuestionIds
    ? customQuestionIds.map(getQuestion).filter(Boolean)
    : getPoolQuestions(chapterId, type);

  if (!pool.length) return null;
  if (order === "random") pool = shuffle(pool);
  else pool = [...pool].sort((first, second) => first.number - second.number);

  const requested =
    count === "all" ? pool.length : Math.min(Math.max(1, Number(count) || 1), pool.length);
  pool = pool.slice(0, requested);

  const now = new Date().toISOString();
  const chapterTitle =
    source === "wrong"
      ? "历史错题"
      : chapterId === "all"
        ? "全部章节"
        : CHAPTER_MAP.get(chapterId)?.title || "全部章节";

  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    chapterId,
    chapterTitle,
    type,
    order,
    source,
    requestedCount: count,
    questionIds: pool.map((question) => question.id),
    currentIndex: 0,
    answers: {},
    summary: null,
  };
}

async function confirmReplaceActiveSession() {
  const active = getActiveSession();
  if (!active || active.completedAt) return true;
  return confirmDialog({
    title: "开始新的练习？",
    message: `当前还有一组未完成的练习，已完成 ${Object.keys(active.answers).length} / ${
      active.questionIds.length
    } 题。开始新练习后，这组进度将被替换；已经提交的答题记录仍会保留。`,
    confirmLabel: "开始新练习",
  });
}

async function beginSession(config) {
  if (!(await confirmReplaceActiveSession())) return;
  const session = createSession(config);
  if (!session) {
    showToast("当前筛选条件下没有题目");
    return;
  }
  data.activeSession = session;
  ui.pendingSelections[session.id] = {};
  saveData();
  navigate("practice");
}

function startComposerSession() {
  beginSession({
    chapterId: ui.composer.chapterId,
    order: ui.composer.order,
    count: ui.composer.count,
    type: ui.composer.type,
    source: "chapter",
  });
}

function getWrongPracticeIds() {
  return Object.entries(data.wrongBook)
    .map(([questionId, entry]) => ({ questionId, entry, question: getQuestion(questionId) }))
    .filter(({ question, entry }) => {
      if (!question) return false;
      if (ui.wrongFilter === "pending") return !entry.masteredAt;
      if (ui.wrongFilter === "mastered") return Boolean(entry.masteredAt);
      return true;
    })
    .sort(
      (first, second) =>
        new Date(second.entry.lastWrongAt).getTime() -
        new Date(first.entry.lastWrongAt).getTime(),
    )
    .map(({ questionId }) => questionId);
}

function startWrongPractice(count = "all", questionIds = null) {
  const ids = questionIds || getWrongPracticeIds();
  if (!ids.length) {
    showToast("当前筛选下没有可重练的错题");
    return;
  }
  beginSession({
    chapterId: "all",
    order: ui.wrongOrder,
    count,
    type: "all",
    source: "wrong",
    customQuestionIds: ids,
  });
}

function setSelectedOption(key) {
  const session = getActiveSession();
  const question = getCurrentQuestion();
  if (!session || !question || session.answers[question.id]) return;
  if (!question.options.some((option) => option.key === key)) return;

  const selected = getPendingSelection(session, question);
  let nextSelected;
  if (question.type === "多选题") {
    nextSelected = selected.includes(key)
      ? selected.filter((item) => item !== key)
      : [...selected, key].sort();
  } else {
    nextSelected = [key];
  }
  ui.pendingSelections[session.id][question.id] = nextSelected;

  document.querySelectorAll('[data-action="select-option"]').forEach((button) => {
    const active = nextSelected.includes(button.dataset.key);
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const submitButton = document.querySelector('[data-action="submit-answer"]');
  if (submitButton) submitButton.disabled = nextSelected.length === 0;
}

function recordWrongResult(question, selected, correct) {
  const existing = data.wrongBook[question.id];
  const now = new Date().toISOString();
  if (!correct) {
    data.wrongBook[question.id] = {
      firstWrongAt: existing?.firstWrongAt || now,
      lastWrongAt: now,
      wrongCount: (existing?.wrongCount || 0) + 1,
      lastSelected: selected,
      correctStreak: 0,
      reviewCount: existing?.reviewCount || 0,
      masteredAt: null,
    };
    return;
  }

  if (existing) {
    data.wrongBook[question.id] = {
      ...existing,
      lastSelected: selected,
      correctStreak: (existing.correctStreak || 0) + 1,
      reviewCount: (existing.reviewCount || 0) + 1,
      masteredAt: now,
    };
  }
}

function submitCurrentAnswer() {
  const session = getActiveSession();
  const question = getCurrentQuestion();
  if (!session || !question || session.answers[question.id]) return;
  const selected = getPendingSelection(session, question);
  if (!selected.length) {
    showToast("请先选择一个答案");
    return;
  }

  const correct = isCorrectAnswer(question, selected);
  const submittedAt = new Date().toISOString();
  session.answers[question.id] = { selected: [...selected], correct, submittedAt };
  data.attempts.push({
    id: `attempt-${session.id}-${question.id}`,
    sessionId: session.id,
    questionId: question.id,
    chapterId: question.chapterId,
    selected: [...selected],
    correct,
    answeredAt: submittedAt,
  });
  if (data.attempts.length > MAX_ATTEMPTS) {
    data.attempts = data.attempts.slice(-MAX_ATTEMPTS);
  }
  recordWrongResult(question, selected, correct);
  saveData();
  redrawPractice();
}

function completeCurrentSession() {
  const session = getActiveSession();
  if (!session) return;
  if (!session.completedAt) {
    session.completedAt = new Date().toISOString();
    const result = getSessionResult(session);
    session.summary = {
      ...result,
      durationSeconds: getSessionElapsed(session),
    };
    const existingIndex = data.history.findIndex((item) => item.id === session.id);
    if (existingIndex >= 0) data.history.splice(existingIndex, 1);
    data.history.unshift(session);
    data.history = data.history.slice(0, MAX_HISTORY);
    saveData();
  }
  navigate("result");
}

function goToNextQuestion() {
  const session = getActiveSession();
  if (!session) return;
  if (!session.answers[session.questionIds[session.currentIndex]]) {
    showToast("请先完成本题");
    return;
  }
  if (session.currentIndex >= session.questionIds.length - 1) {
    completeCurrentSession();
    return;
  }
  session.currentIndex += 1;
  saveData();
  redrawPractice();
  document.querySelector(".practice-view")?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function goToPreviousQuestion() {
  const session = getActiveSession();
  if (!session || session.currentIndex <= 0) return;
  session.currentIndex -= 1;
  saveData();
  redrawPractice();
  document.querySelector(".practice-view")?.scrollIntoView({ block: "start", behavior: "smooth" });
}

async function exitPractice() {
  const session = getActiveSession();
  if (!session) {
    return true;
  }
  const answered = Object.keys(session.answers).length;
  if (!answered) {
    return true;
  }
  const confirmed = await confirmDialog({
    title: "暂时退出练习？",
    message: `已完成的 ${answered} 题会保存下来，下次可以从首页继续。`,
    confirmLabel: "退出并保存",
  });
  return confirmed;
}

function confirmDialog({ title, message, confirmLabel = "确定", cancelLabel = "取消", danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog";
    dialog.innerHTML = `
      <div class="dialog-head">
        <div><h2>${escapeHTML(title)}</h2></div>
        <button class="dialog-close" type="button" data-dialog-cancel aria-label="关闭">
          ${icon("x")}
        </button>
      </div>
      <div class="confirm-body"><p>${escapeHTML(message)}</p></div>
      <div class="dialog-actions">
        <button class="button button-secondary" type="button" data-dialog-cancel>${escapeHTML(
          cancelLabel,
        )}</button>
        <button class="button ${danger ? "button-danger" : "button-primary"}" type="button" data-dialog-confirm>
          ${escapeHTML(confirmLabel)}
        </button>
      </div>
    `;
    document.body.appendChild(dialog);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      dialog.close();
      dialog.remove();
    };
    dialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-dialog-confirm]")) finish(true);
      else if (event.target.closest("[data-dialog-cancel]")) finish(false);
      else if (event.target === dialog) finish(false);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.showModal();
    dialog.querySelector("[data-dialog-cancel]")?.focus();
  });
}

function openSessionDialog(sessionId) {
  const session = data.history.find((item) => item.id === sessionId);
  if (!session) {
    showToast("没有找到这组练习记录");
    return;
  }
  const result = getSessionResult(session);
  const duration = session.summary?.durationSeconds || getSessionElapsed(session);
  const rows = session.questionIds
    .map((questionId, index) => {
      const question = getQuestion(questionId);
      const answer = session.answers[questionId];
      if (!question) return "";
      const correct = Boolean(answer?.correct);
      return `
        <div class="dialog-question${correct ? "" : " is-wrong"}">
          <div class="dialog-question-head">
            <span class="status-dot"></span>
            <strong>${index + 1}. ${escapeHTML(question.stem)}</strong>
          </div>
          <p>你的答案：${escapeHTML(selectedAnswerText(question, answer?.selected || []))}</p>
          <p>正确答案：${escapeHTML(answerText(question))}</p>
          ${
            correct
              ? ""
              : `<div class="analysis"><div class="analysis-label">${icon(
                  "spark",
                )}解析</div>${escapeHTML(question.analysis)}</div>`
          }
        </div>
      `;
    })
    .join("");

  const dialog = document.createElement("dialog");
  dialog.className = "app-dialog";
  dialog.innerHTML = `
    <div class="dialog-head">
      <div>
        <h2>${escapeHTML(session.chapterTitle)}</h2>
        <p>${escapeHTML(formatDate(session.completedAt || session.createdAt, true))} · 正确率 ${
          result.score
        }% · 用时 ${escapeHTML(formatDuration(duration))}</p>
      </div>
      <button class="dialog-close" type="button" data-dialog-cancel aria-label="关闭">
        ${icon("x")}
      </button>
    </div>
    <div class="dialog-body">
      <div class="dialog-session-meta">
        <span class="meta-pill type">${escapeHTML(ORDER_LABELS[session.order])}</span>
        <span class="meta-pill">${escapeHTML(TYPE_LABELS[session.type] || "全部题型")}</span>
        <span class="meta-pill">${result.total} 题</span>
        <span class="meta-pill">答对 ${result.correct} 题</span>
      </div>
      ${rows}
    </div>
    <div class="dialog-actions">
      <button class="button button-primary" type="button" data-dialog-cancel>关闭</button>
    </div>
  `;
  document.body.appendChild(dialog);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-dialog-cancel]") || event.target === dialog) close();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.showModal();
  dialog.querySelector("[data-dialog-cancel]")?.focus();
}

function updateComposerChoices(groupSelector, attribute, value) {
  document.querySelectorAll(`${groupSelector} [data-action="${attribute}"]`).forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function refreshComposerSummary() {
  const summary = getComposerSummary();
  const summaryEl = document.getElementById("builder-summary");
  if (summaryEl) {
    summaryEl.textContent = summary.text;
    const countText = summaryEl.parentElement?.childNodes;
    if (countText) summaryEl.parentElement.innerHTML = `<strong id="builder-summary">${escapeHTML(
      summary.text,
    )}</strong>共 ${summary.count} 题`;
  }

  const countButtons = document.querySelectorAll('[data-action="set-composer-count"]');
  countButtons.forEach((button) => {
    const key = button.dataset.value;
    if (key === "all") button.textContent = `全部 ${summary.poolSize}`;
    else button.textContent = String(Math.min(Number(key), summary.poolSize));
  });
}

function setComposerChoice(key, value) {
  if (key === "order") {
    ui.composer.order = value;
    updateComposerChoices(".segmented", "set-composer-order", value);
  }
  if (key === "count") {
    ui.composer.count = value;
    updateComposerChoices(".pick-row", "set-composer-count", value);
  }
  if (key === "type") {
    ui.composer.type = value;
    updateComposerChoices(".pick-row", "set-composer-type", value);
  }
  refreshComposerSummary();
}

function chooseChapter(chapterId) {
  if (!CHAPTER_MAP.has(chapterId)) return;
  ui.composer.chapterId = chapterId;
  const select = document.querySelector('[data-field="composer-chapter"]');
  if (select) select.value = chapterId;
  refreshComposerSummary();
  document.getElementById("practice-builder")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function exportData() {
  const payload = {
    app: "maogai-quiz",
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `毛概研习记录-${localDateKey(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  showToast("练习记录已导出");
}

async function importDataFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const candidate = parsed?.data || parsed;
    if (!candidate || (!Array.isArray(candidate.attempts) && !Array.isArray(candidate.history))) {
      throw new Error("文件结构不正确");
    }
    const confirmed = await confirmDialog({
      title: "导入练习记录？",
      message: "导入会替换当前浏览器中的练习记录。若当前记录仍需保留，请先导出备份。",
      confirmLabel: "确认导入",
    });
    if (!confirmed) return;
    data = normalizeData(candidate);
    saveData();
    renderCurrentView();
    showToast("练习记录已导入");
  } catch (error) {
    console.warn("导入失败：", error);
    showToast("导入失败，请选择由本站导出的 JSON 文件");
  } finally {
    importInput.value = "";
  }
}

async function clearAllData() {
  const confirmed = await confirmDialog({
    title: "清空全部练习记录？",
    message: "答题记录、错题本和练习历史都会从当前浏览器中删除，且无法恢复。题库本身不会受到影响。",
    confirmLabel: "确认清空",
    danger: true,
  });
  if (!confirmed) return;
  data = createDefaultData();
  ui.pendingSelections = {};
  saveData();
  navigate("home");
  showToast("练习记录已清空");
}

function getSessionWrongIds(session) {
  if (!session) return [];
  return session.questionIds.filter((questionId) => {
    const answer = session.answers[questionId];
    return !answer || !answer.correct;
  });
}

function retryCurrentSession(lastSession) {
  if (!lastSession) return;
  if (lastSession.source === "wrong") {
    startWrongPractice(lastSession.requestedCount);
    return;
  }
  const resultIds = getSessionWrongIds(lastSession);
  const customIds = resultIds.length === lastSession.questionIds.length ? resultIds : null;
  beginSession({
    chapterId: lastSession.chapterId,
    order: lastSession.order,
    count: lastSession.requestedCount,
    type: lastSession.type,
    source: "chapter",
    customQuestionIds: customIds,
  });
}

document.addEventListener("click", (event) => {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  switch (action) {
    case "route-home":
      if (parseRoute() === "practice") {
        event.preventDefault();
        exitPractice().then((canLeave) => {
          if (canLeave) navigate("home");
        });
      } else {
        navigate("home");
      }
      break;
    case "route-wrong":
      if (parseRoute() === "practice") {
        exitPractice().then((canLeave) => {
          if (canLeave) navigate("wrong");
        });
      } else {
        navigate("wrong");
      }
      break;
    case "route-history":
      if (parseRoute() === "practice") {
        exitPractice().then((canLeave) => {
          if (canLeave) navigate("history");
        });
      } else {
        navigate("history");
      }
      break;
    case "toggle-theme":
      toggleTheme();
      break;
    case "focus-builder":
      document.getElementById("practice-builder")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      break;
    case "choose-chapter":
      chooseChapter(actionEl.dataset.chapter);
      break;
    case "set-composer-order":
      setComposerChoice("order", actionEl.dataset.value);
      break;
    case "set-composer-count":
      setComposerChoice("count", actionEl.dataset.value);
      break;
    case "set-composer-type":
      setComposerChoice("type", actionEl.dataset.value);
      break;
    case "start-composer":
      startComposerSession();
      break;
    case "resume-session": {
      const session = getActiveSession();
      if (!session) navigate("home");
      else navigate(session.completedAt ? "result" : "practice");
      break;
    }
    case "exit-practice":
      exitPractice().then((canLeave) => {
        if (canLeave) navigate("home");
      });
      break;
    case "select-option":
      setSelectedOption(actionEl.dataset.key);
      break;
    case "submit-answer":
      submitCurrentAnswer();
      break;
    case "next-question":
      goToNextQuestion();
      break;
    case "previous-question":
      goToPreviousQuestion();
      break;
    case "set-wrong-filter":
      ui.wrongFilter = ["all", "pending", "mastered"].includes(actionEl.dataset.value)
        ? actionEl.dataset.value
        : "all";
      ui.expandedWrongId = null;
      renderWrongBookIntoView();
      break;
    case "set-wrong-order":
      ui.wrongOrder = actionEl.dataset.value === "random" ? "random" : "sequence";
      document.querySelectorAll('[data-action="set-wrong-order"]').forEach((button) => {
        const active = button.dataset.value === ui.wrongOrder;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      break;
    case "start-wrong":
      startWrongPractice(actionEl.dataset.count || "all");
      break;
    case "toggle-wrong":
      ui.expandedWrongId =
        ui.expandedWrongId === actionEl.dataset.question ? null : actionEl.dataset.question;
      renderWrongBookIntoView();
      break;
    case "open-session":
      openSessionDialog(actionEl.dataset.id);
      break;
    case "practice-result-wrong": {
      const session = getActiveSession();
      const wrongIds = getSessionWrongIds(session);
      startWrongPractice("all", wrongIds);
      break;
    }
    case "retry-session":
      retryCurrentSession(getActiveSession());
      break;
    case "export-data":
      exportData();
      break;
    case "import-data":
      importInput.click();
      break;
    case "clear-data":
      clearAllData();
      break;
    default:
      break;
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches('[data-field="composer-chapter"]')) {
    ui.composer.chapterId = CHAPTER_MAP.has(event.target.value) ? event.target.value : "all";
    refreshComposerSummary();
  }
});

importInput.addEventListener("change", () => {
  importDataFile(importInput.files?.[0]);
});

window.addEventListener("hashchange", () => {
  renderCurrentView({ scroll: true });
});

window.addEventListener("beforeunload", () => {
  stopClock();
  saveData();
});

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    data = loadData();
    renderCurrentView();
  }
});

function renderWrongBookIntoView() {
  main.innerHTML = renderWrongBook();
  updateChrome("wrong");
  document.querySelector(".wrong-toolbar")?.scrollIntoView({ block: "start" });
}

applyTheme(document.documentElement.dataset.theme);
renderCurrentView({ scroll: false });
