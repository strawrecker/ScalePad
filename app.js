const defaultPresets = window.scalePadPresets || [];
/* 改过名的问卷：旧名字 → 新名字（旧的保存、上次的选择、没做完的测试都按新名字找） */
const renamedPresets = { 数轴实验: '数轴评估', 点数比较实验: '点数比较评估' };
const currentPresetName = (name) => renamedPresets[name] || name;


const presetStorageKey = 'scalepad_presets_v3';
const voiceStorageKey = 'scalepad_voice_v2';
const planStorageKey = 'scalepad_plan_v1';
const adaptiveStorageKey = 'scalepad_adaptive_v1'; /*@A*/
const buildTag = '2026-10-20b';
let presets = loadPresets();

let questionIndex = 0;
let activeQuestions = [];
let plan = loadPlan();
let activePlan = [];
let ageBand = '';
let epilepsy = '';
let education = '';
let lettersFamiliar = '';
//@A{
/* 发布包分“标准版 / 自适应版”，由 config.js 决定是否提供自适应 */
const adaptiveAvailable = window.scalePadConfig?.adaptive !== false;
let adaptive = adaptiveAvailable && localStorage.getItem(adaptiveStorageKey) === 'on';
//@A}
let skipScope = 'one';
let sequenceTimer = null;
let doctorScriptOpen = false;
/* 系统合成语音发音含糊，默认关闭，由医生口头读题；需要时可在“更多设置”里打开 */
let voiceEnabled = localStorage.getItem(voiceStorageKey) === 'on';
let isSpeaking = false;
let answers = [];
let answerByQuestion = {};
let patient = '';
let patientAge = '';
let patientName = '';
let patientOccupation = '';
let patientGender = '';
let editingIndex = null;
let directoryHandle = null;
let advanceTimer = null;
let pendingAnswer = null;
let pendingRevision = 0;
let logDb = null;
let sessionId = null;
let sessionStartedAt = 0;
let sessionSequence = 0;
let sessionEventCache = [];
let currentQuestionTelemetry = null;
let storageReady = false;
let storageFailure = '';
let storageAlertShown = false;
let opfsLogDirectory = null;
let opfsWriteQueue = Promise.resolve();
let directoryWriteQueue = Promise.resolve();
let directoryLogFileName = '';
let isStarting = false;
const eventWritePromises = new Set();
const logDbName = 'scalepad_live_logs_v1';
const logDbVersion = 1;
const $ = (id) => document.getElementById(id);

/* 跳过原因代码：写入答题记录和导出文件，结果页按代码统计 */
const skipReasons = [
  ['001', '过于简单'],
  ['002', '太难，做不出来'],
  ['003', '不熟悉内容（不认识名人、不熟悉英文字母等）'],
  ['004', '拒绝作答或疲劳'],
  ['005', '设备或操作问题'],
  ['009', '其他原因']
];
const skipReasonLabel = (code) => skipReasons.find(([key]) => key === code)?.[1] || '';

/* 医生对口头回答的标记：按钮只显示数字，患者看不出对错。
 * 名人面孔识别只有三个键：1 正确、2 错误、3 没见过。见过但说不出来记 2（错），没见过记 3，这题不计入正确率。
 * 没见过在记录里存为 mark '4'，和以前的记录保持一致。 */
const markLabels = { 1: '正确', 2: '错误', 3: '不确定', 4: '没见过' };
const markLegend = '1 正确；2 错误；3 不确定（不计入正确率）；名人面孔识别里 3 = 没见过（不计入正确率）';
const marksFor = (question) => (question.unseenMark
  ? [{ key: '1', mark: '1' }, { key: '2', mark: '2' }, { key: '3', mark: '4', label: '没见过' }]
  : [{ key: '1', mark: '1' }, { key: '2', mark: '2' }, { key: '3', mark: '3' }]);

/* 名人题里患者没见过的人：识别题医生标 4，比较题患者点“有人不认识”。这题排除，不算对也不算错 */
const legacyUnseenOptions = ['有人没见过'];
function isUnseen(question, record) {
  return Boolean(record && !record.skipped && (record.mark === '4' || (question?.unseenOption && (record.answer === question.unseenOption || legacyUnseenOptions.includes(record.answer)))));
}

/* 正确率写成“0.89 (9)”：括号里是计入正确率的题数 */
const formatRate = (correct, counted) => (counted ? `${(correct / counted).toFixed(2)} (${counted})` : '—');

function planLabel() {
  if (!activePlan.length) return '未选择';
  const names = [...new Set(activePlan.map((step) => step.preset))];
  return names.length === 1 ? names[0] : `${names[0]} 等 ${names.length} 份问卷`;
}

function safeFilePart(value) {
  return String(value || 'session').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'session';
}

function openLogDb() {
  if (!window.indexedDB) return Promise.reject(new Error('当前浏览器不支持 IndexedDB'));
  if (logDb) return Promise.resolve(logDb);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(logDbName, logDbVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('sessions')) database.createObjectStore('sessions', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('events')) {
        const events = database.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('sessionId', 'sessionId', { unique: false });
      }
      if (!database.objectStoreNames.contains('probes')) database.createObjectStore('probes', { keyPath: 'id' });
    };
    request.onsuccess = () => { logDb = request.result; resolve(logDb); };
    request.onerror = () => reject(request.error || new Error('无法打开本机记录数据库'));
  });
}

function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const transaction = logDb.transaction(storeName, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(`无法写入 ${storeName}`));
    transaction.objectStore(storeName).put(value);
  });
}

function idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = logDb.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`无法读取 ${storeName}`));
  });
}

function idbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = logDb.transaction(storeName, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(`无法清理 ${storeName}`));
    transaction.objectStore(storeName).delete(key);
  });
}

function idbGetSessionEvents(id) {
  return new Promise((resolve, reject) => {
    const transaction = logDb.transaction('events', 'readonly');
    const request = transaction.objectStore('events').index('sessionId').getAll(IDBKeyRange.only(id));
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => a.sequence - b.sequence));
    request.onerror = () => reject(request.error || new Error('无法读取答题记录'));
  });
}

function setQuizStatus(message) {
  const line = $('quizStatus');
  if (!line) return;
  line.textContent = message;
  line.classList.toggle('hidden', !message);
}

function setStorageStatus(message, state = '') {
  const status = $('storageStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `storage-status ${state}`.trim();
}

function reportStorageFailure(error, source = '本机记录') {
  storageFailure = `${source}失败：${error?.message || error}`;
  storageReady = false;
  setStorageStatus(`${storageFailure}，答题已暂停，请先处理保存问题。`, 'error');
  if (!storageAlertShown) {
    storageAlertShown = true;
    window.alert(`答题记录${source}失败。当前答案没有被安全保存，系统已暂停继续答题。\n\n${error?.message || error}`);
  }
}

async function verifyDirectoryHandle(handle) {
  if (!handle) return false;
  if (handle.queryPermission) {
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted' && handle.requestPermission) permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('没有该文件夹的写入权限');
  }
  const probeName = `.scalepad-write-test-${Date.now()}.tmp`;
  const target = await handle.getFileHandle(probeName, { create: true });
  const writable = await target.createWritable();
  await writable.write('ScalePad write test');
  await writable.close();
  const content = await (await target.getFile()).text();
  if (content !== 'ScalePad write test') throw new Error('文件夹写入校验内容不一致');
  if (handle.removeEntry) await handle.removeEntry(probeName);
  return true;
}

async function prepareOpfs() {
  opfsLogDirectory = null;
  if (!navigator.storage?.getDirectory) return false;
  const root = await navigator.storage.getDirectory();
  opfsLogDirectory = await root.getDirectoryHandle('ScalePad-logs', { create: true });
  return true;
}

async function prepareStorage() {
  storageAlertShown = false;
  try {
    await openLogDb();
    const probe = { id: `startup-${Date.now()}`, checkedAt: new Date().toISOString() };
    await idbPut('probes', probe);
    const savedProbe = await idbGet('probes', probe.id);
    await idbDelete('probes', probe.id);
    if (!savedProbe) throw new Error('本机记录读回校验失败');
    let opfsReady = false;
    try { opfsReady = await prepareOpfs(); } catch (error) { console.warn('OPFS 不可用，将使用 IndexedDB。', error); }
    if (directoryHandle) await verifyDirectoryHandle(directoryHandle);
    if (navigator.storage?.persist) {
      try { await navigator.storage.persist(); } catch (error) { console.warn('无法请求持久化存储权限。', error); }
    }
    storageReady = true;
    storageFailure = '';
    const destinations = [`IndexedDB 本机实时记录${opfsReady ? '、OPFS 副本' : ''}`];
    if (directoryHandle) destinations.push(`自定义文件夹：${directoryHandle.name}`);
    setStorageStatus(`存储校验通过：${destinations.join('；')}`, 'ok');
    return true;
  } catch (error) {
    reportStorageFailure(error, '存储校验');
    return false;
  }
}

async function writeDirectoryLine(line) {
  if (!directoryHandle || !directoryLogFileName) return;
  const target = await directoryHandle.getFileHandle(directoryLogFileName, { create: true });
  const existing = await (await target.getFile()).text();
  const writable = await target.createWritable();
  await writable.write(existing + line);
  await writable.close();
}

async function writeOpfsEvent(record) {
  if (!opfsLogDirectory) return;
  const name = `${sessionId}-${String(record.sequence).padStart(6, '0')}.json`;
  const target = await opfsLogDirectory.getFileHandle(name, { create: true });
  const writable = await target.createWritable();
  await writable.write(JSON.stringify(record, null, 2));
  await writable.close();
}

async function persistEvent(event) {
  if (!storageReady || !sessionId) return false;
  const record = {
    id: `${sessionId}:${String(sessionSequence).padStart(8, '0')}`,
    sessionId,
    sequence: sessionSequence,
    recordedAt: new Date().toISOString(),
    ...event
  };
  sessionSequence += 1;
  try {
    await idbPut('events', record);
    sessionEventCache.push(record);
  } catch (error) {
    reportStorageFailure(error, '本机记录');
    return false;
  }
  opfsWriteQueue = opfsWriteQueue.then(() => writeOpfsEvent(record)).catch((error) => {
    console.warn('OPFS 副本写入失败。', error);
    setStorageStatus('本机 IndexedDB 仍可用，但 OPFS 副本写入失败。', 'error');
  });
  if (directoryHandle) {
    directoryWriteQueue = directoryWriteQueue.then(() => writeDirectoryLine(`${JSON.stringify(record)}\n`)).catch((error) => {
      directoryHandle = null;
      setStorageStatus(`自定义文件夹写入失败；本机记录仍已保存。${error?.message || error}`, 'error');
      window.alert(`自定义文件夹无法继续写入。当前题目仍已保存到本机记录，但请检查文件夹权限。\n\n${error?.message || error}`);
    });
  }
  return true;
}

function writeEvent(event) {
  const promise = persistEvent(event);
  eventWritePromises.add(promise);
  promise.then(() => eventWritePromises.delete(promise), () => eventWritePromises.delete(promise));
  return promise;
}

function questionFields(question, index = questionIndex) {
  return {
    questionIndex: index,
    section: question.section || '',
    question: question.text || '',
    display: question.display ?? question.text ?? ''
  };
}

/* ---------- 评分 ---------- */

function normalizeAnswer(value) {
  return String(value ?? '').toLowerCase().replace(/[\s\/、，,。．.·:：;；!！?？"'“”‘’()（）\-—_]/g, '');
}

function isCorrect(question, answer) {
  const expected = question.correct;
  if (expected === undefined || expected === null || expected === '') return false;
  const given = normalizeAnswer(answer);
  if (!given) return false;
  return [String(expected), ...String(expected).split('/')].some((candidate) => normalizeAnswer(candidate) === given);
}

function scaleScore(question, answer) {
  const position = (question.options || []).indexOf(answer);
  if (position < 0 || !Array.isArray(question.values)) return 0;
  return question.values[position] ?? 0;
}

function hasAnswer(record) {
  return Boolean(record) && !record.skipped && (String(record.answer ?? '').trim() !== '' || Boolean(record.mark) || Boolean(record.adaptiveCredited)); /*@A*/
  //@E return Boolean(record) && !record.skipped && (String(record.answer ?? '').trim() !== '' || Boolean(record.mark));
}

/* 自适应计为正确的题算对；有医生标记时以标记为准，否则按标准答案比对 */ /*@A*/
//@E /* 有医生标记时以标记为准，否则按标准答案比对 */
function recordCorrect(question, record) {
  if (record.adaptiveCredited) return true; /*@A*/
  if (record.mark) return record.mark === '1';
  return isCorrect(question, record.answer);
}

/* 按分区汇总：答对 / 已答（总题数） */
function sectionStats() {
  const order = [];
  const groups = new Map();
  activeQuestions.forEach((question, index) => {
    const key = question.planIndex ?? (question.section || '未分区');
    if (!groups.has(key)) {
      groups.set(key, { code: partCode(order.length), name: question.section || '未分区', source: question.planPreset || '', scoring: question.scoring || 'auto', total: 0, answered: 0, correct: 0, credited: 0, stopped: 0, uncertain: 0, unseen: 0, score: 0, maxScore: 0, skipped: 0, skipCodes: {}, skipNotes: [], durations: [] }); /*@A*/
      //@E groups.set(key, { code: partCode(order.length), name: question.section || '未分区', source: question.planPreset || '', scoring: question.scoring || 'auto', total: 0, answered: 0, correct: 0, uncertain: 0, unseen: 0, score: 0, maxScore: 0, skipped: 0, skipCodes: {}, skipNotes: [] });
      order.push(key);
    }
    const group = groups.get(key);
    group.total += 1;
    if (group.scoring === 'scale' && Array.isArray(question.values)) group.maxScore += Math.max(...question.values);
    const record = answerByQuestion[index];
    if (record && !adaptiveAutoRecord(record) && !record.skipped && record.answerDurationMs > 0) group.durations.push(record.answerDurationMs); /*@A*/
    if (record?.skipped) {
      group.skipped += 1;
      if (record.adaptiveStopped) group.stopped += 1; /*@A*/
      group.skipCodes[record.skipCode] = (group.skipCodes[record.skipCode] || 0) + 1;
      if (record.skipNote) group.skipNotes.push(`第 ${index - activeQuestions.findIndex((item) => (item.planIndex ?? item.section) === key) + 1} 题（${record.skipCode}）：${record.skipNote}`);
      return;
    }
    if (!hasAnswer(record)) return;
    group.answered += 1;
    if (group.scoring === 'scale') group.score += scaleScore(question, record.answer);
    else if (group.scoring === 'task') {
      group.taskScore = record.answer;
      group.taskRT = record.taskResult?.totalResponseTimeMs;
    } else if (group.scoring === 'record') return;
    else if (record.adaptiveCredited) { group.correct += 1; group.credited += 1; } /*@A*/
    else if (isUnseen(question, record)) group.unseen += 1;
    else if (record.mark === '3') group.uncertain += 1;
    else if ((group.scoring === 'auto' || record.mark) && recordCorrect(question, record)) group.correct += 1;
  });
//@A{
  return order.map((key) => {
    const group = groups.get(key);
    /* 自适应省下的时间：省略题数 × 本部分实际作答的中位用时 */
    group.savedMs = group.credited + group.stopped && group.durations.length ? (group.credited + group.stopped) * median(group.durations) : 0;
    return group;
  });
//@A}
  //@E return order.map((key) => groups.get(key));
}
//@A{

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const formatMinutes = (ms) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)} 分钟` : `${Math.round(ms / 1000)} 秒`);
//@A}

function beginQuestionTelemetry(question) {
  currentQuestionTelemetry = {
    ...questionFields(question),
    presentedAt: new Date().toISOString(),
    presentedAtMs: Date.now(),
    firstActionAt: null,
    firstActionAtMs: null,
    reactionTimeMs: null,
    choiceClicks: 0,
    answerChanges: 0,
    inputChangeCount: 0,
    audioPlayCount: 0,
    lastAnswer: null
  };
}

function registerAction(answer, kind = 'choice') {
  if (!currentQuestionTelemetry) return;
  const now = Date.now();
  if (!currentQuestionTelemetry.firstActionAtMs) {
    currentQuestionTelemetry.firstActionAtMs = now;
    currentQuestionTelemetry.firstActionAt = new Date(now).toISOString();
    currentQuestionTelemetry.reactionTimeMs = Math.max(0, now - currentQuestionTelemetry.presentedAtMs);
  }
  if (kind === 'choice') {
    currentQuestionTelemetry.choiceClicks += 1;
    if (currentQuestionTelemetry.lastAnswer !== null && currentQuestionTelemetry.lastAnswer !== answer) currentQuestionTelemetry.answerChanges += 1;
    currentQuestionTelemetry.lastAnswer = answer;
  }
}

function telemetrySnapshot() {
  if (!currentQuestionTelemetry) return {};
  const { presentedAtMs, firstActionAtMs, lastAnswer, ...snapshot } = currentQuestionTelemetry;
  return { ...snapshot, lastAnswer };
}

function loadPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(presetStorageKey));
    if (Array.isArray(saved) && saved.length && saved.every(isValidPreset)) {
      const savedByName = new Map(saved.map((preset) => [currentPresetName(preset.name), { ...preset, name: currentPresetName(preset.name) }]));
      const merged = defaultPresets.map((preset) => {
        const custom = savedByName.get(preset.name);
        savedByName.delete(preset.name);
        return custom ? syncWithDefaults(custom, preset) : clonePreset(preset);
      });
      return [...merged, ...savedByName.values()];
    }
  } catch (error) {
    console.warn('无法读取本地问卷，将使用默认问卷。', error);
  }
  return defaultPresets.map(clonePreset);
}

/* 旧版本保存的问卷：按分区 + 题干对应到默认题库，屏幕显示文字等编辑器改不了的字段跟默认题库同步 */
function syncWithDefaults(custom, preset) {
  const defaults = new Map(preset.questions.map((question) => [`${question.section}\n${question.text}`, question]));
  const bySection = (questions) => questions.reduce((map, question) => map.set(question.section, [...(map.get(question.section) || []), question]), new Map());
  const defaultSections = bySection(preset.questions);
  const seen = new Map();
  /* 部分顺序跟默认题库一致（默认题库调整过顺序时，旧的保存也跟着调整；默认里没有的部分保持在后面） */
  const sectionOrder = [...defaultSections.keys()];
  const rank = (question) => {
    const at = sectionOrder.indexOf(question.section);
    return at < 0 ? sectionOrder.length : at;
  };
  const ordered = custom.questions.map((question, index) => ({ question, index }))
    .sort((a, b) => rank(a.question) - rank(b.question) || a.index - b.index)
    .map(({ question }) => question);
  return {
    ...custom,
    questions: ordered.map((question) => {
      const position = seen.get(question.section) || 0;
      seen.set(question.section, position + 1);
      let base = defaults.get(`${question.section}\n${question.text}`);
      /* 题库改过题干（如字母构建改回原版表述）：同分区、同位置、答案相同就跟着更新题干和选项。
       * 答案只是改了写法（高 → 高 / 长）也算相同 */
      if (!base) {
        const candidate = defaultSections.get(question.section)?.[position];
        const sameAnswer = candidate && (candidate.correct === question.correct || normalizeAnswer(candidate.correct).startsWith(normalizeAnswer(question.correct)));
        if (!sameAnswer) return question;
        base = candidate;
        question = { ...question, text: base.text, audioText: base.audioText, options: [...(base.options || [])], correct: base.correct };
      }
      /* 编辑器改不了的字段一律跟默认题库走 */
      question = { ...question };
      const synced = { display: base.display, sectionIntro: base.sectionIntro };
      ['unseenOption', 'unseenMark', 'fullPart', 'example'].forEach((key) => {
        if (key in base) synced[key] = base[key];
        else delete question[key];
      });
      /* 第三个按钮改过名（有人没见过 → 有人不认识）：旧记录的按钮跟着换名 */
      if (base.unseenOption) {
        const options = question.options.filter((option) => !legacyUnseenOptions.includes(option) && option !== base.unseenOption);
        synced.options = [...options, base.unseenOption];
      }
      return { ...question, ...synced, ...('hard' in question || !base.hard ? {} : { hard: true }) }; /*@A*/
      //@E return { ...question, ...synced };
    })
  };
}

function clonePreset(preset) {
  return {
    name: preset.name,
    questions: preset.questions.map((question) => ({
      ...question,
      options: [...(question.options || [])],
      ...(Array.isArray(question.values) ? { values: [...question.values] } : {})
    }))
  };
}

function isValidPreset(preset) {
  return preset && typeof preset.name === 'string' && Array.isArray(preset.questions) && preset.questions.every((question) => question && typeof question.text === 'string' && ((question.response === 'text' || question.response === 'task') || (Array.isArray(question.options) && question.options.length >= 2)));
}

function savePresets() {
  localStorage.setItem(presetStorageKey, JSON.stringify(presets));
}

function loadPlan() {
  try {
    const saved = JSON.parse(localStorage.getItem(planStorageKey));
    if (Array.isArray(saved)) return mergeIntoSets(saved.filter((name) => typeof name === 'string').map(currentPresetName));
  } catch (error) {
    console.warn('无法读取上次选择的量表。', error);
  }
  return [];
}

/* 旧版本选过同一套的感知和想象两卷 → 换成这一套（先感知、再想象） */
function mergeIntoSets(names) {
  let result = [...names];
  defaultPresets.filter((preset) => preset.parts).forEach((set) => {
    if (!set.parts.every((part) => result.includes(part))) return;
    const at = Math.min(...set.parts.map((part) => result.indexOf(part)));
    result = result.filter((name) => !set.parts.includes(name));
    result.splice(at, 0, set.name);
  });
  return result;
}

function savePlan() {
  localStorage.setItem(planStorageKey, JSON.stringify(plan));
}

/* 30 岁以下用 18–30 岁版名人题；填了年龄自动选中，医生可再手动改 */
function bandFromAge() {
  const age = $('patientAge').value.trim();
  if (!/^\d+$/.test(age)) return '';
  return Number(age) < 31 ? 'young' : 'older';
}

const groupHeadings = { task: '认知任务（全屏进行；用 iPad 时请横放）', child: '儿童版问卷（按需选择）' };
let showBipParts = false;

/* 儿童版问卷、认知任务单独成组，由医生按需勾选 */
function presetGroup(preset) {
  return defaultPresets.find((item) => item.name === preset.name)?.group || '';
}

function planPresets() {
  return plan.map((name) => presets.find((preset) => preset.name === name)).filter(Boolean);
}

function planNeedsLetters() {
  return planPresets().some((preset) => preset.questions.some((question) => question.needsLetters));
}

/* 选了一整套就去掉同一套里单独的卷，反之亦然，避免重复做 */
function togglePlan(name) {
  const order = plan.indexOf(name);
  if (order >= 0) {
    plan.splice(order, 1);
  } else {
    const sets = defaultPresets.filter((preset) => preset.parts);
    const set = sets.find((preset) => preset.name === name);
    const owner = sets.find((preset) => preset.parts.includes(name));
    const conflicts = set ? set.parts : owner ? [owner.name] : [];
    plan = plan.filter((item) => !conflicts.includes(item));
    plan.push(name);
  }
  savePlan();
  renderScaleList();
}

function scaleButton(preset) {
  const order = plan.indexOf(preset.name);
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `scale-item${order >= 0 ? ' on' : ''}`;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = order >= 0 ? String(order + 1) : '';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = preset.name;
  item.append(badge, name);
  item.onclick = () => togglePlan(preset.name);
  return item;
}

function groupHeading(text) {
  const heading = document.createElement('p');
  heading.className = 'scale-group';
  heading.textContent = text;
  return heading;
}

/* 上面：BIP A 套 / B 套（感知 + 想象一起做）；需要时点“分开做”只选感知或想象；下面：其他问卷 */
function renderScaleList() {
  const list = $('scaleList');
  list.innerHTML = '';
  const sets = presets.filter((preset) => presetGroup(preset) === 'bipSet');
  const parts = presets.filter((preset) => presetGroup(preset) === 'bipPart');
  if (sets.length) {
    list.append(groupHeading('BIP 套题（感知 + 想象一起做，先感知、再想象）'));
    const grid = document.createElement('div');
    grid.className = 'set-grid';
    sets.forEach((preset) => grid.append(scaleButton(preset)));
    list.append(grid);
  }
  if (parts.length) {
    const open = showBipParts || parts.some((preset) => plan.includes(preset.name));
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'parts-toggle';
    toggle.textContent = open ? '分开做（只做感知或只做想象）▾' : '特殊情况：分开做（只做感知或只做想象）▸';
    toggle.onclick = () => { showBipParts = !open; renderScaleList(); };
    list.append(toggle);
    if (open) {
      const grid = document.createElement('div');
      grid.className = 'set-grid parts';
      parts.forEach((preset) => grid.append(scaleButton(preset)));
      list.append(grid);
    }
  }
  let lastGroup = 'bip';
  presets.filter((preset) => !['bipSet', 'bipPart'].includes(presetGroup(preset))).forEach((preset) => {
    const group = presetGroup(preset);
    if (lastGroup !== group) list.append(groupHeading(groupHeadings[group] || '其他问卷'));
    lastGroup = group;
    list.append(scaleButton(preset));
  });

  $('start').textContent = plan.length > 1 ? `开始（${plan.length} 份）` : '开始';
  $('ageBandNote').textContent = ageBand ? '' : '填写年龄会自动选中，也可直接点选';
  $('epilepsyNo').classList.toggle('selected', epilepsy === 'no');
  $('epilepsyYes').classList.toggle('selected', epilepsy === 'yes');
  $('bandYoung').classList.toggle('selected', ageBand === 'young');
  $('bandOlder').classList.toggle('selected', ageBand === 'older');
  document.querySelectorAll('[data-education]').forEach((button) => button.classList.toggle('selected', button.dataset.education === education));
  document.querySelectorAll('[data-gender]').forEach((button) => button.classList.toggle('selected', button.dataset.gender === patientGender));
  $('adaptiveRow').classList.toggle('hidden', !adaptiveAvailable); /*@A*/
  $('adaptiveOff').classList.toggle('selected', !adaptive); /*@A*/
  $('adaptiveOn').classList.toggle('selected', adaptive); /*@A*/
  $('lettersYes').classList.toggle('selected', lettersFamiliar === 'yes');
  $('lettersNo').classList.toggle('selected', lettersFamiliar === 'no');
  $('lettersNote').textContent = lettersFamiliar === 'no'
    ? '字母相关题会自动记为跳过（003）'
    : !lettersFamiliar && planNeedsLetters() ? '所选量表含字母题，请先确认' : '';
}

$('bandYoung').onclick = () => { ageBand = 'young'; renderScaleList(); };
$('bandOlder').onclick = () => { ageBand = 'older'; renderScaleList(); };
$('epilepsyNo').onclick = () => { epilepsy = 'no'; renderScaleList(); };
//@A{
const setAdaptive = (on) => {
  adaptive = on;
  try { localStorage.setItem(adaptiveStorageKey, on ? 'on' : 'off'); } catch (error) { /* 只是记住偏好 */ }
  renderScaleList();
};
$('adaptiveOff').onclick = () => setAdaptive(false);
$('adaptiveOn').onclick = () => setAdaptive(true);
//@A}
document.querySelectorAll('[data-gender]').forEach((button) => {
  button.onclick = () => { patientGender = button.dataset.gender; renderScaleList(); };
});
document.querySelectorAll('[data-education]').forEach((button) => {
  button.onclick = () => { education = button.dataset.education; renderScaleList(); };
});
$('lettersYes').onclick = () => { lettersFamiliar = 'yes'; renderScaleList(); };
$('lettersNo').onclick = () => { lettersFamiliar = 'no'; renderScaleList(); };
$('epilepsyYes').onclick = () => {
  epilepsy = window.confirm('受试者有癫痫病史。本测试包含图片与画面切换材料，确认仍要继续吗？') ? 'yes' : '';
  renderScaleList();
};

updateHomeButton();
renderVoiceToggle();
renderScaleList();
$('buildTag').textContent = `版本 ${buildTag}`;
$('patientAge').oninput = () => { ageBand = bandFromAge() || ageBand; renderScaleList(); };

$('chooseSaveFolder').onclick = chooseSaveFolder;

/* 认知任务按物理尺寸画：用尺子量这条 10 厘米的线，填入实测长度即可校准 */
function renderCalibration() {
  const tasks = window.ScalePadTasks;
  $('calibBar').style.width = `${10 * tasks.pxPerCm()}px`;
  $('calibStatus').textContent = `数轴按比例铺满屏幕绘制（原程序为 ${tasks.LINE_CM} 厘米）；校准后结果里会记下实际画出的长度`;
}
$('calibSave').onclick = () => {
  const measured = Number($('calibInput').value);
  if (!(measured > 2 && measured < 30)) {
    window.alert('请填写这条线实际量得的长度（厘米），例如 9.6。');
    return;
  }
  window.ScalePadTasks.setPxPerCm(window.ScalePadTasks.pxPerCm() * 10 / measured);
  $('calibInput').value = '';
  renderCalibration();
};
renderCalibration();
setupHomeButton();
$('prevQuestion').onclick = () => { void goPrevQuestion(); };
$('nextQuestion').onclick = () => { void goNextQuestion(); };
$('skipButton').onclick = openSkipMenu;
$('skipClose').onclick = closeSkipMenu;
$('skipOverlay').onclick = (event) => { if (event.target === $('skipOverlay')) closeSkipMenu(); };
$('skipScopeOne').onclick = () => { skipScope = 'one'; renderSkipMenu(); };
$('skipScopePart').onclick = () => { skipScope = 'part'; renderSkipMenu(); };
$('speakQuestion').onclick = toggleSpeech;
$('partsButton').onclick = openPartsMenu;
$('partsClose').onclick = closePartsMenu;
$('partsOverlay').onclick = (event) => { if (event.target === $('partsOverlay')) closePartsMenu(); };
$('finishNow').onclick = () => { closePartsMenu(); void finish({ cover: false }); };

function renderVoiceToggle() {
  $('voiceOff').classList.toggle('selected', !voiceEnabled);
  $('voiceOn').classList.toggle('selected', voiceEnabled);
  $('quizVoiceToggle').textContent = `语音：${voiceEnabled ? '开' : '关'}`;
  $('quizVoiceToggle').classList.toggle('selected', voiceEnabled);
  $('speakQuestion').classList.toggle('hidden', !voiceEnabled);
  $('questionWrap').classList.toggle('no-voice', !voiceEnabled);
}

function setVoice(enabled) {
  voiceEnabled = enabled;
  localStorage.setItem(voiceStorageKey, voiceEnabled ? 'on' : 'off');
  if (!voiceEnabled) stopSpeaking();
  renderVoiceToggle();
}

$('voiceOff').onclick = () => setVoice(false);
$('voiceOn').onclick = () => setVoice(true);
$('quizVoiceToggle').onclick = () => setVoice(!voiceEnabled);

async function chooseSaveFolder() {
  if (!window.showDirectoryPicker) {
    $('saveStatus').textContent = '当前浏览器不支持直接绑定文件夹；本机记录仍会逐题保存，完成后可导出到“下载”';
    return;
  }
  try {
    const selected = await window.showDirectoryPicker({ mode: 'readwrite' });
    await verifyDirectoryHandle(selected);
    directoryHandle = selected;
    directoryLogFileName = '';
    $('saveStatus').textContent = `已选择并验证：${directoryHandle.name}`;
    setStorageStatus('自定义文件夹写入校验通过。开始测试前仍会再次检查。', 'ok');
  } catch (error) {
    if (error.name !== 'AbortError') {
      directoryHandle = null;
      $('saveStatus').textContent = '文件夹选择或写入校验失败，请重试';
      setStorageStatus(error.message || '文件夹校验失败', 'error');
    }
  }
}

/* 选中顺序 = 作答顺序；板块（planIndex）用于分区统计和“跳过本部分”。
 * 恢复旧测试时用同样的规则重建题目，保证题号与记录对得上。 */
function buildPlan(chosen, band, adaptiveMode = false, savedPlan = null) { /*@A*/
//@E function buildPlan(chosen, band) {
  const steps = [];
  let questions = []; /*@A*/
  //@E const questions = [];
  chosen.forEach((preset) => {
    preset.questions
      .filter((question) => !question.ageBand || question.ageBand === band)
      .forEach((question) => {
        const last = steps[steps.length - 1];
        if (!last || last.preset !== preset.name || last.section !== question.section) {
          steps.push({ preset: preset.name, section: question.section, count: 0 });
        }
        steps[steps.length - 1].count += 1;
        questions.push({ ...question, planIndex: steps.length - 1, planPreset: preset.name });
      });
  });
//@A{
  if (adaptiveMode) {
    /* 自适应：可自适应的部分把难题排到前面（各自保持原顺序）。
     * 恢复旧测试时按当时记下的部分来排，规则改过也不会让题号错位。 */
    const stepKey = (step) => `${currentPresetName(step.preset)}\n${renamedPresets[step.section] || step.section}`;
    const savedAdaptive = Array.isArray(savedPlan) ? new Set(savedPlan.filter((step) => step.adaptive).map(stepKey)) : null;
    const adaptiveParts = new Set(steps.map((step, index) => index).filter((index) => (savedAdaptive
      ? savedAdaptive.has(stepKey(steps[index]))
      : isAdaptivePart(questions.filter((question) => question.planIndex === index)))));
    questions = steps.flatMap((step, index) => {
      const part = questions.filter((question) => question.planIndex === index);
      if (!adaptiveParts.has(index)) return part;
      step.adaptive = true;
      return [...part.filter((question) => question.hard), ...part.filter((question) => !question.hard)];
    });
  }
//@A}
  return { plan: steps, questions };
}

/* 题库调整过部分顺序后，恢复旧测试仍按当时的部分顺序排题，保证题号与记录对得上 */
function alignToSavedPlan(built, savedPlan) {
  const key = (step) => `${currentPresetName(step.preset)}\n${renamedPresets[step.section] || step.section}`;
  const groups = new Map(built.plan.map((step, index) => [key(step), { step, questions: built.questions.filter((question) => question.planIndex === index) }]));
  if (!Array.isArray(savedPlan) || savedPlan.length !== built.plan.length || groups.size !== built.plan.length || !savedPlan.every((step) => groups.has(key(step)))) return built;
  const plan = [];
  const questions = [];
  savedPlan.forEach((saved, index) => {
    const group = groups.get(key(saved));
    plan.push(group.step);
    group.questions.forEach((question) => questions.push({ ...question, planIndex: index }));
  });
  return { plan, questions };
}

//@A{
/* 有对错、题数多于 5 题的部分才走自适应；名人题（fullPart）无论如何全部做完 */
function isAdaptivePart(part) {
  return part.length > adaptiveMinItems
    && part.every((question) => (question.scoring === 'auto' || question.scoring === 'manual') && !question.fullPart);
}

/* 自适应：只在本部分结果已经很明确时才省略题目，看不出来就全部做完，不考虑用时上限。
 * 难题排在前面。按作答顺序：
 * - 连续答对 5 题 → 本部分剩下的题自动计为正确；
 * - 连续答错（含标 3 不确定）4 题 → 本部分剩下的题按 002（太难）自动跳过（本部分至少实际做满 5 题才生效）。
 * 不看用时：做得慢但答对的人照常做完。 */
const adaptiveMinItems = 5;
const adaptivePassRight = 5;
const adaptiveStopWrong = 4;

function adaptiveAutoRecord(record) {
  return Boolean(record && (record.adaptiveStopped || record.adaptiveCredited || record.autoSkipped));
}

function adaptiveRecordOk(index) {
  const record = answerByQuestion[index];
  return hasAnswer(record) && record.mark !== '3' && recordCorrect(activeQuestions[index], record);
}

/* 只看截至最后一道实际作答题、仍在延续的连对 / 连错；中间隔着没做的题或自动记录就重新计数 */
function adaptiveVerdict(indexes) {
  let right = 0;
  let wrong = 0;
  let pass = false;
  let stop = false;
  let real = 0;
  for (const index of indexes) {
    const record = answerByQuestion[index];
    if (!record || adaptiveAutoRecord(record)) { right = 0; wrong = 0; continue; }
    real += 1;
    if (adaptiveRecordOk(index)) { right += 1; wrong = 0; } else { wrong += 1; right = 0; }
    pass = right >= adaptivePassRight;
    stop = wrong >= adaptiveStopWrong;
  }
  const enough = real >= Math.min(adaptiveMinItems, indexes.length);
  return { passed: enough && pass, stopped: enough && stop };
}

/* 条件成立时写入自动记录；之后改了答案导致条件不再成立，撤销这些自动记录，题目重新变成待答 */
async function applyAdaptive(planIndex) {
  if (!activePlan[planIndex]?.adaptive) return true;
  const indexes = activeQuestions.map((question, index) => index).filter((index) => activeQuestions[index].planIndex === planIndex);
  if (indexes.some((index) => activeQuestions[index].fullPart)) return true;
  const { passed, stopped } = adaptiveVerdict(indexes);
  const time = new Date().toISOString();
  const writes = [];
  const revoke = (index) => writes.push(writeEvent({ type: 'adaptive_revoked', ...questionFields(activeQuestions[index], index), index, time }).then((saved) => {
    if (saved) delete answerByQuestion[index];
    return saved;
  }));
  indexes.forEach((index) => {
    const record = answerByQuestion[index];
    if (stopped && !record) {
      const skipped = { ...questionFields(activeQuestions[index], index), index, answer: '', skipped: true, skipCode: '002', skipReason: skipReasonLabel('002'), adaptiveStopped: true, time };
      writes.push(writeEvent({ type: 'question_skipped', ...skipped }).then((saved) => {
        if (saved) answerByQuestion[index] = skipped;
        return saved;
      }));
    } else if (!stopped && record?.adaptiveStopped) revoke(index);
  });
  indexes.forEach((index) => {
    const record = answerByQuestion[index];
    if (passed && !record) {
      const credited = { ...questionFields(activeQuestions[index], index), index, answer: '', adaptiveCredited: true, time };
      writes.push(writeEvent({ type: 'adaptive_credited', ...credited }).then((saved) => {
        if (saved) answerByQuestion[index] = credited;
        return saved;
      }));
    } else if (!passed && record?.adaptiveCredited) revoke(index);
  });
  const results = await Promise.all(writes);
  rebuildAnswers();
  return results.every(Boolean);
}
//@A}

async function startSession() {
  if (isStarting) return;
  isStarting = true;
  $('start').disabled = true;
  const unlock = () => { $('start').disabled = false; isStarting = false; };
  patient = $('patient').value.trim() || '未填写';
  patientAge = $('patientAge').value.trim();
  patientName = $('patientName').value.trim();
  patientOccupation = $('patientOccupation').value.trim();
  if (patientAge && (!/^\d+$/.test(patientAge) || Number(patientAge) > 120)) {
    window.alert('年龄请输入 0 到 120 之间的整数。');
    unlock();
    return;
  }
  if (!epilepsy) {
    window.alert('请先确认受试者有无癫痫病史。');
    unlock();
    return;
  }
  if (!plan.length) {
    window.alert('请先选择至少一份量表。');
    unlock();
    return;
  }
  const chosen = planPresets();
  if (!lettersFamiliar && planNeedsLetters()) {
    window.alert('所选量表含英文字母题，请先确认受试者是否熟悉英文字母。');
    unlock();
    return;
  }
  if (!ageBand && chosen.some((preset) => preset.questions.some((question) => question.ageBand))) {
    window.alert('所选量表含分年龄版本的名人题，请先填写年龄。');
    unlock();
    return;
  }
  ({ plan: activePlan, questions: activeQuestions } = buildPlan(chosen, ageBand, adaptive)); /*@A*/
  //@E ({ plan: activePlan, questions: activeQuestions } = buildPlan(chosen, ageBand));
  if (!activeQuestions.length) {
    window.alert('所选量表没有可作答的题目。');
    unlock();
    return;
  }
  if (!(await prepareStorage())) {
    unlock();
    return;
  }
  sessionId = `${safeFilePart(patient)}-${Date.now()}`;
  sessionStartedAt = Date.now();
  sessionSequence = 0;
  sessionEventCache = [];
  directoryLogFileName = `${safeFilePart(patient)}_${sessionId}.jsonl`;
  try {
    await idbPut('sessions', {
      id: sessionId,
      patient,
      age: patientAge || null,
      ...patientProfile(),
      preset: planLabel(),
      plan: activePlan,
      ageBand,
      epilepsy,
      education,
      lettersFamiliar,
      adaptive, /*@A*/
      questionCount: activeQuestions.length,
      startedAt: new Date(sessionStartedAt).toISOString(),
      status: 'active'
    });
    if (!(await writeEvent({ type: 'session_started', patient, age: patientAge || null, ...patientProfile(), preset: planLabel(), ageBand, epilepsy, education, lettersFamiliar, adaptive, questionCount: activeQuestions.length }))) throw new Error('无法写入测试开始记录'); /*@A*/
    //@E if (!(await writeEvent({ type: 'session_started', patient, age: patientAge || null, ...patientProfile(), preset: planLabel(), ageBand, epilepsy, education, lettersFamiliar, questionCount: activeQuestions.length }))) throw new Error('无法写入测试开始记录');
  } catch (error) {
    reportStorageFailure(error, '测试开始记录');
    unlock();
    return;
  }
  answers = [];
  answerByQuestion = {};
  seenGates = new Set();
  examplesRead = new Set();
  reopenGate = null;
  /* 不熟悉英文字母：字母相关题直接记为 003 跳过，顺序作答时越过 */
  if (lettersFamiliar === 'no') {
    const letterIndexes = activeQuestions.map((question, index) => (question.needsLetters ? index : -1)).filter((index) => index >= 0);
    if (letterIndexes.length && !(await recordSkips(letterIndexes, '003', true))) {
      reportStorageFailure(new Error('无法写入字母题跳过记录'), '测试开始记录');
      unlock();
      return;
    }
  }
  questionIndex = nextOpenIndex(0);
  if (questionIndex >= activeQuestions.length) {
    window.alert('所选量表的题目都已被自动跳过，没有可作答的题目。');
    unlock();
    return;
  }
  showQuiz();
  /* 必须解锁：按钮禁用后外观不变，之前回到首页后“开始”会点不动 */
  unlock();
}

function showQuiz() {
  $('setup').classList.add('hidden');
  $('done').classList.add('hidden');
  $('endCover').classList.add('hidden');
  $('quiz').classList.remove('hidden');
  updateHomeButton();
  renderQuestion();
}

$('start').onclick = () => { void startSession(); };

$('openEditor').onclick = () => {
  $('setup').classList.add('hidden');
  $('editor').classList.remove('hidden');
  updateHomeButton();
  $('presetFilter').value = '';
  renderPresetList();
};

$('backToSetup').onclick = () => {
  $('editor').classList.add('hidden');
  $('setup').classList.remove('hidden');
  updateHomeButton();
  renderScaleList();
};

$('presetFilter').oninput = renderPresetList;

$('newPreset').onclick = () => {
  presets.push({ name: '新建问卷', questions: [{ text: '请输入题目', options: ['是', '否'] }] });
  editingIndex = presets.length - 1;
  savePresets();
  refreshPresetSelect();
  renderPresetList();
  renderEditorForm();
};

$('addQuestion').onclick = () => {
  if (editingIndex === null) return;
  const draft = collectEditorDraft();
  if (draft) presets[editingIndex] = draft;
  presets[editingIndex].questions.push({ text: '请输入题目', options: ['是', '否'] });
  renderEditorForm();
};

$('savePreset').onclick = () => {
  if (editingIndex === null) return;
  const draft = collectEditorDraft();
  if (!draft) return;
  presets[editingIndex] = draft;
  savePresets();
  refreshPresetSelect();
  renderPresetList();
  renderEditorForm();
};

function collectEditorDraft() {
  if (editingIndex === null) return null;
  const source = presets[editingIndex].questions;
  const questions = [...$('questionEditor').querySelectorAll('.question-edit')].map((row) => {
    const base = source[Number(row.dataset.index)] || {};
    const text = row.querySelector('.question-text').value.trim() || '未填写题目';
    const hardBox = row.querySelector('.hard-input'); /*@A*/
    return {
      ...base,
      ...(hardBox ? { hard: hardBox.checked } : {}), /*@A*/
      response: base.response || 'choice',
      text,
      /* 题干改了就同步屏幕文字与朗读文字，除非它们本来就是另外写的 */
      ...(base.display === base.text ? { display: text } : {}),
      ...(base.audioText === base.text ? { audioText: text } : {}),
      options: [...row.querySelectorAll('.option-input')].map((input) => input.value.trim() || '未填写选项')
    };
  }).filter((question) => question.response === 'text' || question.response === 'task' || question.options.length >= 2);
  return {
    name: $('editorName').value.trim() || '未命名问卷',
    questions: questions.length ? questions : [{ text: '请输入题目', options: ['是', '否'] }]
  };
}

function renderPresetList() {
  const filter = $('presetFilter').value.trim().toLowerCase();
  const list = $('presetList');
  list.innerHTML = '';
  presets.forEach((preset, index) => {
    if (filter && !preset.name.toLowerCase().includes(filter)) return;
    const item = document.createElement('button');
    item.className = `preset-item${index === editingIndex ? ' active' : ''}`;
    const name = document.createElement('span');
    name.textContent = preset.name;
    const count = document.createElement('small');
    count.textContent = `${preset.questions.length} 题`;
    item.append(name, count);
    item.onclick = () => {
      editingIndex = index;
      renderPresetList();
      renderEditorForm();
    };
    list.append(item);
  });
  if (!list.children.length) list.innerHTML = '<div class="empty-state">没有匹配的问卷</div>';
}

function renderEditorForm() {
  const form = $('editorForm');
  if (editingIndex === null || !presets[editingIndex]) {
    form.classList.add('hidden');
    return;
  }
  form.classList.remove('hidden');
  $('editorName').value = presets[editingIndex].name;
  const questionEditor = $('questionEditor');
  questionEditor.innerHTML = '';
  presets[editingIndex].questions.forEach((question, questionIndex) => {
    const row = document.createElement('div');
    row.className = 'question-edit';
    row.dataset.index = String(questionIndex);
    const head = document.createElement('div');
    head.className = 'question-head';
    const title = document.createElement('span');
    title.textContent = question.section ? `第 ${questionIndex + 1} 题 · ${question.section}` : `第 ${questionIndex + 1} 题`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除题目';
    remove.onclick = () => {
      if (presets[editingIndex].questions.length <= 1) return;
      const draft = collectEditorDraft();
      if (draft) presets[editingIndex] = draft;
      presets[editingIndex].questions.splice(questionIndex, 1);
      renderEditorForm();
    };
    head.append(title);
//@A{
    /* 有对错的题可勾选“难题”：自适应模式下先做难题 */
    if (question.scoring === 'auto' || question.scoring === 'manual' || !question.scoring) {
      const hardLabel = document.createElement('label');
      hardLabel.className = 'hard-toggle';
      const hardBox = document.createElement('input');
      hardBox.type = 'checkbox';
      hardBox.className = 'hard-input';
      hardBox.checked = Boolean(question.hard);
      hardLabel.append(hardBox, '难题');
      head.append(hardLabel);
    }
//@A}
    head.append(remove);
    const text = document.createElement(question.response === 'text' ? 'textarea' : 'input');
    text.className = 'question-text';
    text.value = question.text;
    text.placeholder = '输入题目';
    row.append(head, text);
    question.options.forEach((option, optionIndex) => {
      const optionRow = document.createElement('div');
      optionRow.className = 'option-row';
      const input = document.createElement('input');
      input.className = 'option-input';
      input.value = option;
      input.placeholder = `选项 ${optionIndex + 1}`;
      optionRow.append(input);
      if (question.options.length > 2) {
        const removeOption = document.createElement('button');
      removeOption.type = 'button';
      removeOption.textContent = '删除';
      removeOption.onclick = () => {
          const draft = collectEditorDraft();
          if (draft) presets[editingIndex] = draft;
          const currentQuestion = presets[editingIndex].questions[questionIndex];
          if (currentQuestion.options.length <= 2) return;
          currentQuestion.options.splice(optionIndex, 1);
          renderEditorForm();
        };
        optionRow.append(removeOption);
      }
      row.append(optionRow);
    });
    if (question.response === 'text' || question.response === 'task') {
      questionEditor.append(row);
      return;
    }
    const addOption = document.createElement('button');
    addOption.type = 'button';
    addOption.className = 'small';
    addOption.textContent = '添加选项';
    addOption.onclick = () => {
      const draft = collectEditorDraft();
      if (draft) presets[editingIndex] = draft;
      presets[editingIndex].questions[questionIndex].options.push('新选项');
      renderEditorForm();
    };
    row.append(addOption);
    questionEditor.append(row);
  });
}

/* 部分名只用小字放在顶部“部分”按钮上，屏幕留给题目 */
function renderBand(question) {
  $('partsButton').textContent = `${partCode(question.planIndex)} 部分 ▾`;
  $('partsButton').title = `${question.section || ''}（${question.planPreset || ''}）`;
  /* 指导语下面再用一句话直接告诉患者要做什么 */
  $('sectionIntro').textContent = '';
  if (question.sectionIntro) {
    const text = document.createElement('span');
    text.className = 'intro-text';
    text.textContent = question.sectionIntro;
    $('sectionIntro').append(text);
  }
  /* 带图的题：题干已经说清楚要做什么，省掉指导语正文给图片让位，只留“→ 要做什么” */
  $('quiz').classList.toggle('media-question', Boolean(question.image || question.sequence));
  const action = introAction(question);
  if (action) {
    const line = document.createElement('span');
    line.className = 'intro-action';
    line.textContent = `→ ${action}`;
    $('sectionIntro').append(line);
  }
  $('sectionIntro').classList.toggle('hidden', !question.sectionIntro && !action);
}

/* 已看过示例 / 交接提示的部分。看过就不再自动出现，从本部分第一题往前翻（上一题 / W）可以翻回来再看 */
let seenGates = new Set();
/* 本次测试里已经看满 5 秒（或点过开始）的示例：再看到同一个示例不用再等 */
let examplesRead = new Set();
let reopenGate = null;
let gateTimer = null;
const exampleReadMs = 5000;


/* 本部分开头要不要先放一页：医生读题 → 患者口答时提示把屏幕转向患者；医生部分 → 患者部分时提示交给患者；空间、时钟题放示例 */
function gateContent(index) {
  const question = activeQuestions[index];
  if (!question || activeQuestions.findIndex((item) => item.planIndex === question.planIndex) !== index) return null;
  const previous = activeQuestions[index - 1];
  /* 医生部分转到患者部分时不再单独出一页“交给患者自己点”，直接进入下一部分 */
  const showPatient = Boolean(previous && previous.delivery === 'audio' && question.delivery !== 'audio' && question.response === 'text');
  const example = question.example ? window.scalePadExamples?.[question.example] : null;
  return showPatient || example ? { showPatient, example } : null;
}

function gateFor(index) {
  const question = activeQuestions[index];
  if (!question) return null;
  if (reopenGate !== question.planIndex && (answerByQuestion[index] || seenGates.has(question.planIndex))) return null;
  return gateContent(index);
}

function dismissGate(question, gate) {
  seenGates.add(question.planIndex);
  if (question.example) examplesRead.add(question.example);
  reopenGate = null;
  if (sessionId && storageReady) void writeEvent({ type: 'gate_dismissed', ...questionFields(question), example: question.example || null });
  renderQuestion();
}

function renderGate(question, gate) {
  $('quiz').classList.remove('media-question');
  const card = $('gateCard');
  card.innerHTML = '';
  if (gate.showPatient) {
    const handoff = document.createElement('div');
    handoff.className = 'gate-handoff';
    handoff.innerHTML = '<strong>医生读题部分已完成</strong><span>请把屏幕转向患者：患者看屏幕大声说出答案，医生在下方记录</span>';
    card.append(handoff);
  }
  if (gate.example) {
    const title = document.createElement('h3');
    title.textContent = `${gate.example.title.replace('示例：', '示例（不计分）：')}`;
    const panels = document.createElement('div');
    panels.className = `gate-panels n${gate.example.panels.length}`;
    /* 每张示例图上方标出答案（是 / 否 等），一眼看出哪张是“是”、哪张是“否” */
    gate.example.panels.forEach((panel) => {
      const figure = document.createElement('figure');
      if (panel.tone) figure.className = `tone-${panel.tone}`;
      if (panel.answer || gate.example.panels.some((item) => item.answer)) {
        const badge = document.createElement('span');
        badge.className = `answer-badge${panel.answer ? '' : ' spacer'}`;
        badge.textContent = !panel.answer ? '—' : panel.answer.length <= 1 ? `选“${panel.answer}”` : panel.answer;
        figure.append(badge);
      }
      const image = document.createElement('img');
      image.src = panel.image;
      image.alt = '示例图';
      const caption = document.createElement('figcaption');
      caption.textContent = panel.caption;
      figure.append(image, caption);
      panels.append(figure);
    });
    card.append(title);
    if (gate.example.note) {
      const note = document.createElement('p');
      note.className = 'gate-note';
      note.textContent = gate.example.note;
      card.append(note);
    }
    card.append(panels);
  }
  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'gate-start';
  start.textContent = gate.example ? '看懂了，开始答题' : '开始';
  start.onclick = () => dismissGate(question, gate);
  card.append(start);
  /* 示例第一次至少看 5 秒，按钮才能点；看过一次再出现就不用等 */
  if (gate.example && !examplesRead.has(question.example)) {
    const readyAt = Date.now() + exampleReadMs;
    start.disabled = true;
    const tick = () => {
      const left = Math.ceil((readyAt - Date.now()) / 1000);
      if (left > 0) {
        start.textContent = `请先看示例（${left} 秒）`;
        gateTimer = window.setTimeout(tick, 200);
        return;
      }
      gateTimer = null;
      examplesRead.add(question.example);
      start.disabled = false;
      start.textContent = '看懂了，开始答题';
    };
    tick();
  }
}

function introAction(question) {
  if (question.response === 'task') return '';
  if (question.delivery === 'audio') return '请听医生读题，大声说出答案';
  if (question.unseenMark) return '请说出这位名人的名字，没见过就说“没见过”';
  if (question.response === 'text') return '请大声说出答案，不用点屏幕';
  return '请点下面的按钮作答';
}

/* 字号：同一部分里所有题目用同一个字号，取这一部分最长的题也放得下的最大字号；选项按钮同理。
 * 换部分、换窗口大小时重新算 */
const fitCache = new Map();
let fitFrame = null;

function fitSize(cacheKey, apply, texts, fits, minPx, maxPx) {
  const key = `${cacheKey}|${window.innerWidth}x${window.innerHeight}`;
  let size = fitCache.get(key);
  if (!size) {
    let low = minPx;
    let high = Math.max(minPx, Math.floor(maxPx));
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      apply(mid);
      if (texts.every(fits)) low = mid;
      else high = mid - 1;
    }
    size = low;
    fitCache.set(key, size);
  }
  apply(size);
  return size;
}

function fitQuestionText() {
  fitFrame = null;
  if ($('quiz').classList.contains('hidden') || $('quiz').classList.contains('gated')) return;
  const question = activeQuestions[questionIndex];
  if (!question) return;
  const part = activeQuestions.filter((item) => item.planIndex === question.planIndex);
  const media = Boolean(question.image || question.sequence);
  const q = $('question');
  const wrap = $('questionWrap');
  const shown = q.textContent;
  q.style.fontSize = '';
  q.style.whiteSpace = '';
  if (question.delivery !== 'audio' && shown) {
    const texts = part.filter((item) => item.delivery !== 'audio' && Boolean(item.image || item.sequence) === media).map((item) => item.display ?? item.text).filter(Boolean);
    const vh = window.innerHeight / 100;
    const vw = window.innerWidth / 100;
    /* 带图的题：题干只占一行，图片尽量大 */
    if (media) q.style.whiteSpace = 'nowrap';
    fitSize(`q|${question.planIndex}|${media}`, (px) => { q.style.fontSize = `${px}px`; }, texts, (text) => {
      q.textContent = text;
      if (q.scrollWidth > q.clientWidth + 1) return false;
      return media || q.getBoundingClientRect().height <= wrap.clientHeight - 20;
    }, 24, media ? Math.min(7 * vh, 6 * vw, 80) : Math.min(18 * vh, 12 * vw, 220));
    q.textContent = shown;
  }
  /* 选项按钮：除“有人不认识”外同一个字号 */
  const buttons = [...document.querySelectorAll('#choices > button.choice:not(.unseen-option)')];
  buttons.forEach((button) => { button.style.fontSize = ''; button.style.whiteSpace = ''; });
  if (buttons.length && !$('choices').classList.contains('free-response')) {
    const probe = buttons[0];
    const original = probe.textContent;
    const options = [...new Set(part.flatMap((item) => (item.options || []).filter((option) => option !== item.unseenOption)))];
    /* 短选项（如“都在左侧”）不拆成两行 */
    const noWrap = options.every((option) => option.length <= 6) ? 'nowrap' : '';
    buttons.forEach((button) => { button.style.whiteSpace = noWrap; });
    const size = fitSize(`c|${question.planIndex}|${buttons.length}`, (px) => { probe.style.fontSize = `${px}px`; }, options, (text) => {
      probe.textContent = text;
      return probe.scrollHeight <= probe.clientHeight + 1 && probe.scrollWidth <= probe.clientWidth + 1;
    }, 20, Math.min(window.innerHeight * 0.14, 170));
    probe.textContent = original;
    buttons.forEach((button) => { button.style.fontSize = `${size}px`; });
  }
}

window.addEventListener('resize', () => {
  fitCache.clear();
  if (fitFrame) window.cancelAnimationFrame(fitFrame);
  fitFrame = window.requestAnimationFrame(fitQuestionText);
});

function renderQuestion() {
  if (fitFrame) window.cancelAnimationFrame(fitFrame);
  fitFrame = window.requestAnimationFrame(fitQuestionText);
  if (advanceTimer) window.clearTimeout(advanceTimer);
  advanceTimer = null;
  if (gateTimer) window.clearTimeout(gateTimer);
  gateTimer = null;
  clearSequenceTimer();
  pendingAnswer = null;
  const question = activeQuestions[questionIndex];
  const options = question.options || [];
  const savedAnswer = answerByQuestion[questionIndex];
  const audioOnly = question.delivery === 'audio';
  renderBand(question);
  /* 部分开头的示例 / 交接提示：看完点“开始”才出题，计时从出题算起 */
  if (reopenGate !== null && firstIndexOfPart(reopenGate) !== questionIndex) reopenGate = null;
  const gate = gateFor(questionIndex);
  $('prevQuestion').disabled = nextOpenIndex(questionIndex - 1, -1) < 0 && (Boolean(gate) || !gateContent(questionIndex));
  $('nextQuestion').disabled = !gate && nextOpenIndex(questionIndex + 1) >= activeQuestions.length;
  $('quiz').classList.toggle('gated', Boolean(gate));
  if (gate) {
    stopSpeaking();
    renderGate(question, gate);
    return;
  }
  beginQuestionTelemetry(question);
  if (sessionId && storageReady) void writeEvent({ type: 'question_presented', ...questionFields(question), presentedAt: currentQuestionTelemetry.presentedAt });
  /* 纯听题：患者看不到题目，屏幕只提示交给医生，由医生读题 */
  const displayText = audioOnly ? '请把设备交给医生' : (question.display ?? question.text);
  $('question').textContent = displayText;
  $('question').className = `q${displayText.length > 34 ? ' small' : displayText.length > 14 ? ' medium' : ''}`;
  $('questionWrap').classList.toggle('empty-question', !displayText);
  $('questionWrap').classList.toggle('handoff', audioOnly);
  $('questionWrap').classList.toggle('with-media', Boolean(question.image || question.sequence));
  $('speakQuestion').classList.toggle('hidden', !voiceEnabled);
  /* 纯听题的题目默认折叠，医生拿到设备后点开照着读。
   * 连续的纯听题保持展开，离开这一段后重新折叠。 */
  if (!audioOnly) doctorScriptOpen = false;
  renderDoctorScript(question);
  const skipped = savedAnswer?.skipped;
  const credited = savedAnswer?.adaptiveCredited; /*@A*/
  /* 只给医生看代码，不写原因，患者看不出为什么跳过（代码含义在首页和结果页） */
  $('skipTag').textContent = skipped ? `已记录 ${savedAnswer.skipCode}` : credited ? '已记录 A' : ''; /*@A*/
  //@E $('skipTag').textContent = skipped ? `已记录 ${savedAnswer.skipCode}` : '';
  $('skipTag').classList.toggle('hidden', !skipped && !credited); /*@A*/
  //@E $('skipTag').classList.toggle('hidden', !skipped);
  stopSpeaking();
  $('questionMedia').innerHTML = '';
  $('questionMedia').classList.remove('stimulus');
  $('questionMedia').classList.toggle('has-image', Boolean(question.image));
  $('choices').classList.remove('pending');
  if (question.sequence) renderSequence(question, hasAnswer(savedAnswer));
  if (question.image?.includes('assets/colors/')) renderColorReveal(question);
  else if (question.image) {
    const image = document.createElement('img');
    image.src = question.image;
    image.alt = '题目材料';
    $('questionMedia').append(image);
  }
  $('choices').innerHTML = '';
  $('choices').classList.toggle('free-response', question.response === 'text');
  $('choices').classList.toggle('many', question.response !== 'text' && options.length > 2);
  $('choices').classList.toggle('long-options', options.some((option) => option.length > 5));
  $('choices').dataset.count = options.length;
  $('choices').classList.toggle('has-unseen', Boolean(question.unseenOption));
  renderBulkFill(question);

  if (question.response === 'task') {
    renderTaskQuestion(question, savedAnswer);
    return;
  }

  if (question.response === 'text') {
    /* 患者只看到“请说出答案”；下方是明显分开的医生记录区，可用键盘 1/2/3 标记，不用抢鼠标 */
    const hint = document.createElement('p');
    hint.className = 'speak-hint';
    hint.textContent = question.unseenMark ? '请说出这位名人的名字，没见过就说“没见过”' : '请说出你的答案';
    const panel = document.createElement('div');
    panel.className = 'doctor-panel';
    const panelTitle = document.createElement('div');
    panelTitle.className = 'doctor-title';
    panelTitle.innerHTML = `<span>医生记录 · 患者无需操作</span><em>键盘 1 / 2 / 3${question.unseenMark ? '（3 = 没见过）' : ''} · 长按 Q / E / 空格跳过</em>`;
    const input = document.createElement('textarea');
    input.className = 'free-response-input';
    input.placeholder = '回答内容（可不填）';
    input.value = savedAnswer ? savedAnswer.answer : '';
    input.addEventListener('input', () => {
      if (!currentQuestionTelemetry) return;
      registerAction(input.value, 'input');
      currentQuestionTelemetry.inputChangeCount += 1;
      void writeEvent({ type: 'input_activity', ...questionFields(question), valueLength: input.value.length, inputChangeCount: currentQuestionTelemetry.inputChangeCount });
    });
    /* 医生按 1/2/3 标记对错后进入下一题；回答文字可记可不记 */
    const marks = document.createElement('div');
    marks.className = 'mark-row';
    marksFor(question).forEach(({ key, mark, label }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `choice mark${label ? ' labeled' : ''}`;
      button.dataset.key = key;
      button.textContent = label ? `${key} ${label}` : key;
      if (savedAnswer?.mark === mark) button.classList.add('selected');
      button.onclick = () => {
        marks.querySelectorAll('.mark').forEach((item) => item.classList.remove('selected'));
        button.classList.add('selected');
        scheduleNext(question, input.value.trim(), mark);
      };
      marks.append(button);
    });
    panel.append(panelTitle, input, marks);
    $('choices').append(hint, panel);
    autoSpeak(question);
    return;
  }

  options.forEach((option) => {
    const button = document.createElement('button');
    button.className = `choice${option === question.unseenOption ? ' unseen-option' : ''}`;
    button.dataset.option = option;
    button.textContent = option;
    if (savedAnswer && savedAnswer.answer === option) button.classList.add('selected');
    button.onclick = () => {
      document.querySelectorAll('.choice').forEach((item) => { item.classList.remove('selected'); });
      button.classList.add('selected');
      scheduleNext(question, option);
    };
    $('choices').append(button);
  });
  autoSpeak(question);
}

/* 认知任务：医生讲完指导语后点“开始”进入全屏任务，完成后整份结果记为本题答案 */
function renderTaskQuestion(question, savedAnswer) {
  $('choices').classList.add('free-response');
  const finished = hasAnswer(savedAnswer) && savedAnswer.taskResult;
  if (finished) {
    const note = document.createElement('p');
    note.className = 'task-done';
    note.textContent = '已完成（分数见结果页）';
    $('choices').append(note);
  }
  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'choice';
  start.textContent = finished ? '重新做一遍' : '开始';
  start.onclick = () => { void runTaskQuestion(question); };
  $('choices').append(start);
}

async function runTaskQuestion(question) {
  const index = questionIndex;
  const tasks = window.ScalePadTasks;
  const fit = tasks.layout();
  if (fit.scaled && !window.confirm(`当前屏幕太小，数轴只有 ${fit.lineCm.toFixed(1)} 厘米（原程序 ${tasks.LINE_CM} 厘米）。\n\n建议把 iPad 横过来，或在电脑上把浏览器窗口最大化。仍要继续吗？`)) return;
  stopSpeaking();
  cancelPendingAnswer();
  setQuizStatus('');
  const fields = { ...questionFields(question, index), task: question.task };
  const presentedAt = new Date().toISOString();
  void writeEvent({ type: 'task_started', ...fields });
  let result;
  try {
    result = await tasks.run(question.task, {
      onTrial: (trial, trialIndex) => { void writeEvent({ type: 'task_trial', ...fields, trialIndex, ...trial }); }
    });
  } catch (error) {
    const reason = error?.message || String(error);
    void writeEvent({ type: 'task_aborted', ...fields, reason });
    renderQuestion();
    /* 任务里长按“跳过”：回到本题后直接打开跳过原因，选完记为跳过 */
    /* 开始页上按“返回”：回到本题，什么都不记 */
    if (reason === 'back') {
      setQuizStatus('');
      return;
    }
    if (reason === 'skipped') {
      setQuizStatus('');
      openSkipMenu();
      return;
    }
    /* 任务里长按 Q / E：直接记 001 / 002 */
    if (reason.startsWith('skip-')) {
      setQuizStatus('');
      skipScope = 'one';
      $('skipNote').value = '';
      void skipQuestions(reason.slice(5));
      return;
    }
    setQuizStatus(reason === 'aborted' ? '任务已中止，本题没有记录结果，可重新开始或跳过。' : `任务出错：${reason}`);
    return;
  }
  const record = {
    ...questionFields(question, index),
    index,
    question: question.text,
    answer: `${result.accuracy.toFixed(2)}/100`,
    taskResult: result,
    presentedAt,
    time: new Date().toISOString()
  };
  if (!(await writeEvent({ type: 'answer_committed', ...record }))) {
    renderQuestion();
    setQuizStatus('任务结果未能写入本机记录，请检查存储后重做本题。');
    return;
  }
  answerByQuestion[index] = record;
  rebuildAnswers();
  questionIndex = nextOpenIndex(index + 1);
  if (questionIndex < activeQuestions.length) renderQuestion();
  else await finish();
}

function renderDoctorScript(question) {
  const audioOnly = question.delivery === 'audio';
  const hiddenPrompt = !(question.display ?? question.text) && !question.image && !question.sequence;
  const line = $('researcherScript');
  line.classList.toggle('hidden', !audioOnly && !hiddenPrompt);
  line.classList.toggle('doctor-read', audioOnly);
  line.classList.toggle('collapsed', audioOnly && !doctorScriptOpen);
  if (!audioOnly) {
    line.textContent = hiddenPrompt ? `医生查看：${question.text}` : '';
    return;
  }
  line.textContent = doctorScriptOpen ? `医生朗读：${question.text}` : '医生朗读 ▸ 点击显示题目';
}

$('researcherScript').onclick = () => {
  const question = activeQuestions[questionIndex];
  if (question?.delivery !== 'audio') return;
  doctorScriptOpen = !doctorScriptOpen;
  renderDoctorScript(question);
};

function clearSequenceTimer() {
  if (sequenceTimer) window.clearTimeout(sequenceTimer);
  sequenceTimer = null;
}

function showStimulus(src) {
  const image = document.createElement('img');
  image.src = src;
  image.alt = '题目材料';
  $('questionMedia').replaceChildren(image);
}

/* 颜色名称：色块不自动出现（连续换色会晃眼），先显示灰色卡片，点一下才显示颜色。
 * 反应时从色块出现时算起。 */
function renderColorReveal(question) {
  new Image().src = question.image;
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'color-reveal';
  card.textContent = '点击显示颜色';
  card.onclick = () => {
    const image = document.createElement('img');
    image.src = question.image;
    image.alt = '色块';
    image.className = 'color-shown';
    $('questionMedia').replaceChildren(image);
    if (currentQuestionTelemetry) {
      const now = Date.now();
      currentQuestionTelemetry.presentedAtMs = now;
      currentQuestionTelemetry.colorShownAt = new Date(now).toISOString();
    }
    void writeEvent({ type: 'stimulus_phase', ...questionFields(question), phase: 'color' });
  };
  $('questionMedia').append(card);
}

/* 空间表征（想象版）：点“开始”后先显示黑点，dotsMs 后黑点消失、只留箭头，这时才出现选项。
 * 反应时从箭头出现开始算。已答过的题回看时选项直接可点，也可以重新播放。 */
function renderSequence(question, answered) {
  const { dots, arrow, dotsMs } = question.sequence;
  [dots, arrow].forEach((src) => { new Image().src = src; });
  $('questionMedia').classList.add('stimulus');
  if (!answered) $('choices').classList.add('pending');
  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'small stimulus-start';
  start.textContent = `${answered ? '重新播放' : '开始'}（黑点显示 ${dotsMs / 1000} 秒）`;
  start.onclick = () => {
    stopSpeaking();
    showStimulus(dots);
    void writeEvent({ type: 'stimulus_phase', ...questionFields(question), phase: 'dots', durationMs: dotsMs });
    sequenceTimer = window.setTimeout(() => {
      sequenceTimer = null;
      showStimulus(arrow);
      $('choices').classList.remove('pending');
      if (currentQuestionTelemetry) {
        const now = Date.now();
        currentQuestionTelemetry.presentedAtMs = now;
        currentQuestionTelemetry.arrowShownAt = new Date(now).toISOString();
      }
      void writeEvent({ type: 'stimulus_phase', ...questionFields(question), phase: 'arrow' });
      autoSpeak(question, true);
    }, dotsMs);
  };
  $('questionMedia').append(start);
}

function scheduleNext(question, answer, mark = '') {
  registerAction(answer, question.response === 'text' ? 'input' : 'choice');
  const revision = pendingRevision + 1;
  pendingRevision = revision;
  const selectionEvent = writeEvent({
    type: 'selection',
    ...questionFields(question),
    answer,
    ...(mark ? { mark } : {}),
    selectedAt: new Date().toISOString(),
    ...telemetrySnapshot()
  });
  pendingAnswer = {
    index: questionIndex,
    question: question.text,
    answer,
    mark,
    selectedAt: new Date().toISOString(),
    revision,
    selectionEvent
  };
  if (advanceTimer) window.clearTimeout(advanceTimer);
  advanceTimer = window.setTimeout(() => { void advanceAfterDelay(revision); }, 900);
}

async function advanceAfterDelay(revision) {
  const pending = pendingAnswer;
  if (!pending || pending.revision !== revision) return;
  const selectionSaved = await pending.selectionEvent;
  if (pendingAnswer?.revision !== revision) return;
  if (!selectionSaved) {
    setQuizStatus('本题答案未能写入本机记录，已暂停。请检查存储后重试本题。');
    return;
  }
  const committed = await commitPendingAnswer();
  if (!committed || pendingAnswer) return;
  setQuizStatus('');
  advanceTimer = null;
  questionIndex = nextOpenIndex(questionIndex + 1);
  if (questionIndex < activeQuestions.length) renderQuestion();
  else await finish();
}

async function commitPendingAnswer() {
  if (!pendingAnswer) return true;
  const pending = pendingAnswer;
  const completedAt = Date.now();
  const telemetry = telemetrySnapshot();
  const record = {
    index: pending.index,
    question: pending.question,
    answer: pending.answer,
    ...(pending.mark ? { mark: pending.mark, markLabel: markLabels[pending.mark] } : {}),
    selectedAt: pending.selectedAt,
    time: new Date(completedAt).toISOString(),
    answerDurationMs: Math.max(0, new Date(pending.selectedAt).getTime() - (currentQuestionTelemetry?.presentedAtMs || completedAt)),
    confirmationDelayMs: Math.max(0, completedAt - new Date(pending.selectedAt).getTime()),
    ...telemetry
  };
  if (!(await writeEvent({ type: 'answer_committed', ...record }))) return false;
  answerByQuestion[pending.index] = record;
  rebuildAnswers();
  pendingAnswer = null;
  currentQuestionTelemetry = null;
  if (!(await applyAdaptive(activeQuestions[pending.index].planIndex))) setQuizStatus('自适应计分未能全部写入本机记录，请检查存储。'); /*@A*/
  return true;
}

/* 按场景分组的量表（VVIQ 每 4 题一个场景）：每组第一题下方多一排“本组全选同一分”的快捷按钮 */
function bulkGroupIndexes(index) {
  const question = activeQuestions[index];
  const size = question.scoring === 'scale' && /^VVIQ/.test(question.section || '') ? 4 : 0;
  if (!size) return [];
  let first = index;
  while (first > 0 && activeQuestions[first - 1].planIndex === question.planIndex) first -= 1;
  if ((index - first) % size) return [];
  const indexes = [];
  for (let item = index; item < index + size && activeQuestions[item]?.planIndex === question.planIndex; item += 1) indexes.push(item);
  return indexes;
}

function renderBulkFill(question) {
  const box = $('bulkFill');
  const indexes = bulkGroupIndexes(questionIndex);
  box.innerHTML = '';
  box.classList.toggle('hidden', indexes.length < 2);
  if (indexes.length < 2) return;
  const label = document.createElement('span');
  label.textContent = `本组 ${indexes.length} 题全选同一分：`;
  box.append(label);
  question.options.forEach((option, position) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'small';
    button.textContent = `全 ${question.values?.[position] ?? option}`;
    button.title = `本组 ${indexes.length} 题全部选“${option}”`;
    button.onclick = () => { void fillGroup(indexes, position); };
    box.append(button);
  });
}

/* 一次写入整组答案（按选项位置取各题自己的选项文字），然后跳到下一组 */
async function fillGroup(indexes, position) {
  cancelPendingAnswer();
  const time = new Date().toISOString();
  const telemetry = telemetrySnapshot();
  const results = await Promise.all(indexes.map((index) => {
    const question = activeQuestions[index];
    const record = {
      ...questionFields(question, index),
      ...(index === questionIndex ? telemetry : {}),
      index,
      answer: question.options[position],
      bulkFilled: true,
      selectedAt: time,
      time
    };
    return writeEvent({ type: 'answer_committed', ...record }).then((saved) => {
      if (saved) answerByQuestion[index] = record;
      return saved;
    });
  }));
  rebuildAnswers();
  if (!results.every(Boolean)) {
    setQuizStatus('本组答案未能写入本机记录，已暂停。请检查存储后重试。');
    renderQuestion();
    return;
  }
  setQuizStatus('');
  currentQuestionTelemetry = null;
  questionIndex = nextOpenIndex(indexes[indexes.length - 1] + 1);
  if (questionIndex < activeQuestions.length) renderQuestion();
  else await finish();
}

function rebuildAnswers() {
  answers = Object.keys(answerByQuestion)
    .sort((a, b) => Number(a) - Number(b))
    .map((indexKey) => answerByQuestion[indexKey]);
}

/* 预先自动跳过的题（如不熟悉字母）和自适应计为正确的题在顺序作答时直接越过；从“部分”菜单仍可进入补做 */ /*@A*/
//@E /* 预先自动跳过的题（如不熟悉字母）在顺序作答时直接越过；从“部分”菜单仍可进入补做 */
function nextOpenIndex(from, step = 1) {
  let index = from;
  while (index >= 0 && index < activeQuestions.length && (answerByQuestion[index]?.autoSkipped || answerByQuestion[index]?.adaptiveCredited || answerByQuestion[index]?.adaptiveStopped)) index += step; /*@A*/
  //@E while (index >= 0 && index < activeQuestions.length && answerByQuestion[index]?.autoSkipped) index += step;
  return index;
}

function cancelPendingAnswer() {
  if (advanceTimer) window.clearTimeout(advanceTimer);
  advanceTimer = null;
  clearSequenceTimer();
  pendingRevision += 1;
  pendingAnswer = null;
}

async function recordSkips(indexes, code, auto, note = '') {
  const skipReason = skipReasonLabel(code);
  const time = new Date().toISOString();
  const results = await Promise.all(indexes.map((index) => {
    const record = {
      ...questionFields(activeQuestions[index], index),
      ...(index === questionIndex && !auto ? telemetrySnapshot() : {}),
      index,
      answer: '',
      skipped: true,
      skipCode: code,
      skipReason,
      ...(note ? { skipNote: note } : {}),
      autoSkipped: auto,
      time
    };
    return writeEvent({ type: 'question_skipped', ...record }).then((saved) => {
      if (saved) answerByQuestion[index] = record;
      return saved;
    });
  }));
  rebuildAnswers();
//@A{
  if (!auto) {
    const parts = new Set(indexes.map((index) => activeQuestions[index].planIndex));
    for (const planIndex of parts) results.push(await applyAdaptive(planIndex));
  }
//@A}
  return results.every(Boolean);
}

/* 仅本题：跳过当前题；本部分剩余题：当前题及本部分后面还没作答的题 */
async function skipQuestions(code) {
  const note = $('skipNote').value.trim();
  closeSkipMenu();
  cancelPendingAnswer();
  const current = activeQuestions[questionIndex];
  const targets = skipScope === 'part'
    ? activeQuestions.map((question, index) => index).filter((index) => index === questionIndex
      || (index > questionIndex && activeQuestions[index].planIndex === current.planIndex && !hasAnswer(answerByQuestion[index])))
    : [questionIndex];
  if (!(await recordSkips(targets, code, false, note))) {
    setQuizStatus('跳过记录未能写入本机记录，已暂停。请检查存储后重试。');
    return;
  }
  setQuizStatus('');
  const next = nextOpenIndex(targets[targets.length - 1] + 1);
  if (next < activeQuestions.length) {
    questionIndex = next;
    renderQuestion();
  } else {
    await finish();
  }
}

function renderSkipMenu() {
  $('skipScopeOne').classList.toggle('selected', skipScope === 'one');
  $('skipScopePart').classList.toggle('selected', skipScope === 'part');
  const list = $('skipList');
  list.innerHTML = '';
  skipReasons.forEach(([code, label]) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'part-item';
    const badge = document.createElement('span');
    badge.className = 'code skip-code';
    badge.textContent = String(skipReasons.findIndex(([key]) => key === code) + 1);
    /* 菜单只显示代码，不写原因，患者看不出为什么跳过 */
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = code;
    item.title = label;
    item.append(badge, name);
    item.onclick = () => { void skipQuestions(code); };
    list.append(item);
  });
}

function openSkipMenu() {
  skipScope = 'one';
  $('skipNote').value = '';
  renderSkipMenu();
  $('skipOverlay').classList.remove('hidden');
}

function closeSkipMenu() {
  $('skipOverlay').classList.add('hidden');
  /* 光标留在隐藏的备注框里会挡住后面的快捷键 */
  if (document.activeElement === $('skipNote')) $('skipNote').blur();
}

const formatSkipCodes = (codes) => Object.entries(codes).sort().map(([code, count]) => `${code}×${count}`).join('、');

async function jumpTo(index, gatePart = null) {
  if (advanceTimer) window.clearTimeout(advanceTimer);
  advanceTimer = null;
  if (pendingAnswer) {
    const saved = await pendingAnswer.selectionEvent;
    if (!saved || !(await commitPendingAnswer())) return;
  }
  reopenGate = gatePart;
  if (index >= activeQuestions.length) {
    await finish();
    return;
  }
  questionIndex = Math.max(0, index);
  renderQuestion();
}

async function navigateTo(index) {
  if (index < 0 || index >= activeQuestions.length) return;
  await jumpTo(index);
}

const isGated = () => $('quiz').classList.contains('gated');

/* 上一题：在本部分第一题时先翻回本部分开头的示例 / 提示页，再往前才是上一部分的最后一题 */
async function goPrevQuestion() {
  const question = activeQuestions[questionIndex];
  if (!isGated() && question && gateContent(questionIndex)) {
    await jumpTo(questionIndex, question.planIndex);
    return;
  }
  await navigateTo(nextOpenIndex(questionIndex - 1, -1));
}

/* 下一题：示例 / 提示页上相当于点“开始”（示例没看满 5 秒时不动） */
function startGate() {
  const start = document.querySelector('#gateCard .gate-start');
  if (start?.disabled) showKeyHint('请先看完示例');
  else start?.click();
}

async function goNextQuestion() {
  if (isGated()) {
    startGate();
    return;
  }
  await navigateTo(nextOpenIndex(questionIndex + 1));
}

/* 上一部分 / 下一部分：跳到那一部分的第一题（没看过的示例页照常先出现） */
async function goPart(step) {
  const current = activeQuestions[questionIndex]?.planIndex ?? 0;
  const target = current + step;
  if (target < 0 || target >= activePlan.length) {
    showKeyHint(step < 0 ? '已经是第一部分' : '已经是最后一部分');
    return;
  }
  const index = firstIndexOfPart(target);
  if (index >= 0) await jumpTo(index);
}

/* 部分代号：A、B、C…… 用来代替具体题号 */
function partCode(index) {
  return index < 26 ? String.fromCharCode(65 + index) : `P${index + 1}`;
}

function firstIndexOfPart(planIndex) {
  return activeQuestions.findIndex((question) => question.planIndex === planIndex);
}

function partState(planIndex) {
  if (planIndex === activeQuestions[questionIndex]?.planIndex) return '当前';
  let total = 0;
  let done = 0;
  const codes = {};
  activeQuestions.forEach((question, index) => {
    if (question.planIndex !== planIndex) return;
    total += 1;
    const record = answerByQuestion[index];
    if (record?.skipped) codes[record.skipCode] = (codes[record.skipCode] || 0) + 1;
    else if (hasAnswer(record)) done += 1;
  });
  const skipped = Object.values(codes).reduce((sum, count) => sum + count, 0);
  const skipText = skipped ? `跳过 ${formatSkipCodes(codes)}` : '';
  if (done === total) return '已完成';
  if (!done && !skipped) return '未作答';
  if (done + skipped === total) return done ? `完成 ${done} · ${skipText}` : skipText;
  return skipped ? `部分作答 · ${skipText}` : '部分作答';
}

function renderPartsMenu() {
  const list = $('partsList');
  list.innerHTML = '';
  activePlan.forEach((step, index) => {
    const current = index === activeQuestions[questionIndex]?.planIndex;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `part-item${current ? ' current' : ''}`;
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = partCode(index);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = step.section;
    const source = document.createElement('small');
    source.textContent = step.preset;
    name.append(source);
    const state = document.createElement('span');
    state.className = 'state';
    state.textContent = partState(index);
    item.append(code, name, state);
    item.onclick = () => { closePartsMenu(); void jumpTo(firstIndexOfPart(index)); };
    list.append(item);
  });
}

function openPartsMenu() {
  renderPartsMenu();
  $('partsOverlay').classList.remove('hidden');
}

function closePartsMenu() {
  $('partsOverlay').classList.add('hidden');
}

function stopSpeaking() {
  isSpeaking = false;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  const button = $('speakQuestion');
  if (!button) return;
  button.classList.remove('speaking');
  button.textContent = '🔊';
  button.title = '朗读题目';
}

/* 手动点击时：正在朗读就停止，否则开始朗读 */
function toggleSpeech() {
  if (isSpeaking) {
    stopSpeaking();
    return;
  }
  speakQuestion(false);
}

/* 开启合成语音时：纯听题由医生手动播放；已经在语音题段落里时（上一题也是语音题）自动播放。
 * 空间表征序列题等箭头出现后再播放。 */
function autoSpeak(question, afterStimulus = false) {
  if (!voiceEnabled) return;
  if (question.sequence && !afterStimulus) return;
  if (question.delivery === 'audio' && activeQuestions[questionIndex - 1]?.delivery !== 'audio') return;
  window.setTimeout(() => speakQuestion(true), 80);
}

function speakQuestion(auto = false) {
  const question = activeQuestions[questionIndex];
  const text = question?.audioText || question?.text;
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined' || !text) return;
  if (currentQuestionTelemetry) {
    currentQuestionTelemetry.audioPlayCount += 1;
    void writeEvent({ type: 'question_audio', ...questionFields(question), auto, audioPlayCount: currentQuestionTelemetry.audioPlayCount });
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.95;
  utterance.onend = stopSpeaking;
  utterance.onerror = stopSpeaking;
  isSpeaking = true;
  $('speakQuestion').classList.add('speaking');
  $('speakQuestion').textContent = '⏹';
  $('speakQuestion').title = '停止朗读';
  window.speechSynthesis.speak(utterance);
}

function updateHomeButton() {
  const onSetup = !$('setup').classList.contains('hidden');
  $('homeButton').classList.toggle('hidden', onSetup);
  document.body.classList.toggle('in-quiz', !$('quiz').classList.contains('hidden'));
  $('homeButton').classList.toggle('guarded', !$('quiz').classList.contains('hidden') || !$('endCover').classList.contains('hidden'));
  $('homeHint').classList.add('hidden');
}

/* 答题中：按住 1.5 秒才回首页，轻点只提示；结果页、编辑页点一下即可 */
function setupHomeButton() {
  const button = $('homeButton');
  const hint = $('homeHint');
  let holdTimer = null;
  let hintTimer = null;
  const showHint = (text) => {
    hint.textContent = text;
    hint.classList.remove('hidden');
    if (hintTimer) window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => hint.classList.add('hidden'), 1800);
  };
  const release = () => {
    if (!holdTimer) return;
    window.clearTimeout(holdTimer);
    holdTimer = null;
    button.classList.remove('holding');
    showHint('长按回首页');
  };
  button.addEventListener('pointerdown', (event) => {
    if (!button.classList.contains('guarded')) return;
    event.preventDefault();
    button.classList.add('holding');
    showHint('继续按住…');
    holdTimer = window.setTimeout(() => {
      holdTimer = null;
      button.classList.remove('holding');
      void goHome();
    }, 1500);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => button.addEventListener(type, release));
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  button.onclick = () => {
    if (!button.classList.contains('guarded')) void goHome();
  };
}

/* 从答题或结果页回首页：测试不丢，首页“最近测试”里可继续作答或查看结果。
 * 患者信息表单清空，避免误点“开始”给同一位患者重复建一份测试。 */
async function goHome() {
  const fromQuiz = !$('quiz').classList.contains('hidden');
  const fromSession = fromQuiz || !$('done').classList.contains('hidden');
  if (advanceTimer) window.clearTimeout(advanceTimer);
  advanceTimer = null;
  if (pendingAnswer) {
    const saved = await pendingAnswer.selectionEvent;
    if (saved) await commitPendingAnswer();
  }
  cancelPendingAnswer();
  currentQuestionTelemetry = null;
  stopSpeaking();
  $('quiz').classList.add('hidden');
  $('editor').classList.add('hidden');
  $('done').classList.add('hidden');
  $('endCover').classList.add('hidden');
  closeSkipMenu();
  closePartsMenu();
  setQuizStatus('');
  if (fromSession) {
    if (fromQuiz && sessionId && storageReady) void writeEvent({ type: 'session_paused', questionIndex });
    resetSetupForm();
  }
  $('setup').classList.remove('hidden');
  if (fromSession) $('setup').scrollTop = 0;
  updateHomeButton();
  renderScaleList();
  void renderRecentSessions();
}

function resetSetupForm() {
  ['patient', 'patientName', 'patientAge', 'patientOccupation'].forEach((id) => { $(id).value = ''; });
  patient = '';
  patientAge = '';
  patientName = '';
  patientOccupation = '';
  patientGender = '';
  ageBand = '';
  epilepsy = '';
  education = '';
  lettersFamiliar = '';
  $('start').disabled = false;
  isStarting = false;
}

async function startNextPatient() {
  await goHome();
  sessionId = null;
  activePlan = [];
  activeQuestions = [];
  answers = [];
  answerByQuestion = {};
  sessionEventCache = [];
  $('patient').focus();
}

function idbGetAllSessions() {
  return new Promise((resolve, reject) => {
    const request = logDb.transaction('sessions', 'readonly').objectStore('sessions').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('无法读取测试列表'));
  });
}

/* 从本机记录重建一次测试：题目按当时的量表和名人题版本重建，答案按事件顺序回放 */
async function loadSession(id) {
  await Promise.all([...eventWritePromises]);
  if (!(await prepareStorage())) return false;
  const record = await idbGet('sessions', id);
  if (!record?.plan) {
    window.alert('这条记录缺少量表信息（旧版本创建），无法恢复。');
    return false;
  }
  const chosen = [...new Set(record.plan.map((step) => currentPresetName(step.preset)))].map((name) => presets.find((preset) => preset.name === name));
  const built = chosen.every(Boolean) ? alignToSavedPlan(buildPlan(chosen, record.ageBand, Boolean(record.adaptive), record.plan), record.plan) : null; /*@A*/
  //@E const built = chosen.every(Boolean) ? alignToSavedPlan(buildPlan(chosen, record.ageBand), record.plan) : null;
  if (!built || built.questions.length !== record.questionCount) {
    window.alert('这次测试用到的问卷已被修改或删除，题目对不上，无法恢复。原始记录仍保存在本机。');
    return false;
  }
  const events = await idbGetSessionEvents(id);
  cancelPendingAnswer();
  currentQuestionTelemetry = null;
  sessionId = id;
  sessionStartedAt = Date.parse(record.startedAt) || Date.now();
  sessionSequence = events.reduce((max, event) => Math.max(max, event.sequence + 1), 0);
  sessionEventCache = events;
  directoryLogFileName = `${safeFilePart(record.patient)}_${id}.jsonl`;
  patient = record.patient || '未填写';
  patientAge = record.age || '';
  patientName = record.name || '';
  patientGender = record.gender || '';
  patientOccupation = record.occupation || '';
  ageBand = record.ageBand || '';
  epilepsy = record.epilepsy || '';
  education = record.education || '';
  lettersFamiliar = record.lettersFamiliar || '';
  activePlan = built.plan;
  activeQuestions = built.questions;
  answerByQuestion = {};
  seenGates = new Set();
  examplesRead = new Set();
  events.forEach(({ id: eventId, sessionId: owner, sequence, recordedAt, type, ...fields }) => {
    if (type === 'answer_committed' || type === 'question_skipped' || type === 'adaptive_credited') answerByQuestion[fields.index] = fields; /*@A*/
    //@E if (type === 'answer_committed' || type === 'question_skipped') answerByQuestion[fields.index] = fields;
    else if (type === 'adaptive_revoked') delete answerByQuestion[fields.index]; /*@A*/
    else if (type === 'gate_dismissed' && activeQuestions[fields.questionIndex]) {
      seenGates.add(activeQuestions[fields.questionIndex].planIndex);
      if (fields.example) examplesRead.add(fields.example);
    }
  });
  reopenGate = null;
  rebuildAnswers();
  return true;
}

/* 回到第一道还没作答也没跳过的题；全部做完就停在最后一题，方便修改 */
async function resumeQuiz() {
  const firstOpen = activeQuestions.findIndex((question, index) => !answerByQuestion[index]);
  questionIndex = firstOpen >= 0 ? firstOpen : activeQuestions.length - 1;
  try {
    await updateSessionRecord({ status: 'active' });
  } catch (error) {
    reportStorageFailure(error, '继续作答记录');
    return;
  }
  void writeEvent({ type: 'session_resumed', questionIndex });
  showQuiz();
}

async function openSession(id, mode) {
  try {
    if (!(await loadSession(id))) return;
  } catch (error) {
    window.alert(`读取测试记录失败：${error?.message || error}`);
    return;
  }
  if (mode === 'resume') await resumeQuiz();
  else showResults();
}

/* 首页测试记录：默认显示最近 5 次，可“显示更多”看全部，也可按编号 / 姓名 / 问卷搜索。
 * 每条的作答进度只在显示出来时才去读取，记录多了也不会卡。 */
let recentLimit = 5;
let recentQuery = '';
const recentPage = 20;
const answeredCache = new Map();

async function sessionAnsweredCount(session) {
  const key = session.id;
  if (answeredCache.has(key)) return answeredCache.get(key);
  const answered = new Set();
  (await idbGetSessionEvents(session.id)).forEach((event) => {
    if (event.type === 'answer_committed' || event.type === 'question_skipped' || event.type === 'adaptive_credited') answered.add(event.index); /*@A*/
    //@E if (event.type === 'answer_committed' || event.type === 'question_skipped') answered.add(event.index);
    else if (event.type === 'adaptive_revoked') answered.delete(event.index); /*@A*/
  });
  answeredCache.set(key, answered.size);
  return answered.size;
}

function sessionRow(session, answered) {
  const row = document.createElement('div');
  row.className = 'session-row';
  const info = document.createElement('div');
  info.className = 'info';
  const completed = session.status === 'completed';
  const who = [session.patient, session.name].filter(Boolean).join(' · ');
  const status = document.createElement('em');
  status.className = completed ? 'done' : '';
  status.textContent = completed ? '已出结果' : '未完成';
  const started = new Date(session.startedAt);
  const sameYear = started.getFullYear() === new Date().getFullYear();
  const meta = document.createElement('small');
  meta.textContent = `${started.toLocaleString('zh-CN', { ...(sameYear ? {} : { year: 'numeric' }), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${session.preset} · 已答/跳过 ${answered}/${session.questionCount}`;
  info.append(who || '未填写', status, meta);
  row.append(info);
  if (!completed) {
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'small selected';
    resume.textContent = '继续作答';
    resume.onclick = () => { void openSession(session.id, 'resume'); };
    row.append(resume);
  }
  const view = document.createElement('button');
  view.type = 'button';
  view.className = 'small';
  view.textContent = '查看结果';
  view.onclick = () => { void openSession(session.id, 'results'); };
  row.append(view);
  return row;
}

async function renderRecentSessions() {
  const box = $('recentSessions');
  answeredCache.clear();
  try {
    await openLogDb();
    const sessions = (await idbGetAllSessions())
      .filter((session) => session.plan)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    if (!sessions.length) {
      box.classList.add('hidden');
      return;
    }
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'recent-head';
    const title = document.createElement('h3');
    title.textContent = `测试记录（共 ${sessions.length} 次）`;
    head.append(title);
    if (sessions.length > 5) {
      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'recent-search';
      search.placeholder = '搜索编号 / 姓名 / 问卷';
      search.value = recentQuery;
      search.oninput = () => { recentQuery = search.value; recentLimit = Math.max(recentLimit, 5); void fillList(); };
      head.append(search);
    }
    const note = document.createElement('p');
    note.textContent = '每题都已保存在本机。中途回到首页或退出程序后，可在这里继续作答或查看结果。';
    const list = document.createElement('div');
    const more = document.createElement('div');
    more.className = 'recent-more';
    box.append(head, note, list, more);
    box.classList.remove('hidden');

    let token = 0;
    async function fillList() {
      const mine = ++token;
      const query = recentQuery.trim().toLowerCase();
      const matched = query
        ? sessions.filter((session) => [session.patient, session.name, session.preset].some((value) => String(value || '').toLowerCase().includes(query)))
        : sessions;
      const shown = matched.slice(0, recentLimit);
      const counts = await Promise.all(shown.map(sessionAnsweredCount));
      if (mine !== token) return;
      list.replaceChildren(...shown.map((session, index) => sessionRow(session, counts[index])));
      if (!matched.length) list.innerHTML = '<p class="recent-empty">没有找到匹配的记录</p>';
      more.innerHTML = '';
      if (matched.length > shown.length) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'small';
        button.textContent = `显示更多（还有 ${matched.length - shown.length} 次）`;
        button.onclick = () => { recentLimit += recentPage; void fillList(); };
        more.append(button);
      }
      if (recentLimit > 5 && shown.length > 5) {
        const fold = document.createElement('button');
        fold.type = 'button';
        fold.className = 'small';
        fold.textContent = '收起';
        fold.onclick = () => { recentLimit = 5; void fillList(); };
        more.append(fold);
      }
    }
    await fillList();
  } catch (error) {
    console.warn('无法读取测试记录。', error);
    box.classList.add('hidden');
  }
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return '—';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(1)} 秒`;
}

const escapeHtml = (value) => String(value).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));

/* 每部分一行：答对/已答（总题数）。量表显示总分。 */
function renderSectionResults() {
  const stats = sectionStats();
  const rows = stats.map((group) => {
    const unanswered = group.total - group.answered - group.skipped;
    const skipNote = [group.credited + group.stopped ? `自适应省略 ${group.credited + group.stopped} 题${group.savedMs ? `，约省 ${formatMinutes(group.savedMs)}` : ''}` : '', group.credited ? `连续答对 ${adaptivePassRight} 题，${group.credited} 题自动计为正确` : '', group.stopped ? `连续答错，${group.stopped} 题自动跳过` : '', group.skipped ? `跳过 ${group.skipped}（${formatSkipCodes(group.skipCodes)}）` : '', unanswered ? `未作答 ${unanswered}` : '', group.uncertain ? `标记 3（不确定）${group.uncertain}，不计入正确率` : '', group.unseen ? `没见过 ${group.unseen}，不计入正确率` : ''].filter(Boolean).join('<br>'); /*@A*/
    //@E const skipNote = [group.skipped ? `跳过 ${group.skipped}（${formatSkipCodes(group.skipCodes)}）` : '', unanswered ? `未作答 ${unanswered}` : '', group.uncertain ? `标记 3（不确定）${group.uncertain}，不计入正确率` : '', group.unseen ? `没见过 ${group.unseen}，不计入正确率` : ''].filter(Boolean).join('<br>');
    const notes = group.skipNotes.length ? `<br><small>备注：${group.skipNotes.map(escapeHtml).join('；')}</small>` : '';
    const judged = group.answered - group.uncertain - group.unseen;
    let result;
    let rate;
    if (group.scoring === 'scale') {
      result = `总分 ${group.score}${group.maxScore ? ` / ${group.maxScore}` : ''}`;
      rate = `已答 ${group.answered}/${group.total}`;
    } else if (group.scoring === 'record') {
      result = `已答 ${group.answered}/${group.total}`;
      rate = '仅记录回答';
    } else if (group.scoring === 'task') {
      result = group.answered ? `准确性评分 ${group.taskScore}` : (group.skipped ? '已跳过' : '未完成');
      rate = group.answered ? `总反应时间 ${Math.round(group.taskRT)} 毫秒` : '—';
    } else {
      result = group.answered ? `${group.correct}/${judged} (${group.total})` : `${group.skipped === group.total ? '全部跳过' : '未作答'} (${group.total})`;
      rate = formatRate(group.correct, judged);
    }
    return `<tr><td>${escapeHtml(group.code)} · ${escapeHtml(group.name)}<small>${escapeHtml(group.source)}</small></td><td class="result">${escapeHtml(result)}</td><td class="rate">${escapeHtml(rate)}</td><td class="skip">${skipNote}${notes}</td></tr>`;
  });
  const scored = stats.filter((group) => !['scale', 'record', 'task'].includes(group.scoring));
  const totals = scored.reduce((sum, group) => ({
    correct: sum.correct + group.correct,
    answered: sum.answered + group.answered - group.uncertain - group.unseen,
    total: sum.total + group.total
  }), { correct: 0, answered: 0, total: 0 });
  const totalRow = scored.length
    ? `<tr class="total"><td>合计（不含量表）</td><td class="result">${totals.correct}/${totals.answered} (${totals.total})</td><td class="rate">${formatRate(totals.correct, totals.answered)}</td><td class="skip"></td></tr>`
    : '';
//@A{
  const omitted = stats.reduce((sum, group) => sum + group.credited + group.stopped, 0);
  const savedMs = stats.reduce((sum, group) => sum + group.savedMs, 0);
  const adaptiveNote = activePlan.some((step) => step.adaptive) ? `<strong>自适应共省略 ${omitted} 题${savedMs ? `，约省 ${formatMinutes(savedMs)}` : ''}。</strong>只在结果明确时省略题目，看不出来就全部做完；名人题全部做完。每部分先做难题：连续答对 ${adaptivePassRight} 题则其余题自动计为正确；至少做满 ${adaptiveMinItems} 题后连续答错 ${adaptiveStopWrong} 题则其余题按 002 自动跳过（不看用时）。“省时”按本部分实际作答的中位用时估算。<br>` : '';
//@A}
  const legend = `<p class="muted">${adaptiveNote}医生标记：${markLegend}<br>跳过代码：${skipReasons.map(([code, label]) => `${code} ${label}`).join('；')}</p>`; /*@A*/
  //@E const legend = `<p class="muted">医生标记：${markLegend}<br>跳过代码：${skipReasons.map(([code, label]) => `${code} ${label}`).join('；')}</p>`;
  $('sectionResults').innerHTML = `<table class="section-table"><thead><tr><th>分区</th><th>答对/计入（总题数）</th><th>正确率（计入题数）</th><th>跳过（代码×题数）</th></tr></thead><tbody>${rows.join('')}${totalRow}</tbody></table>${legend}`;
}

function renderDashboard() {
  const completed = answers.filter(hasAnswer);
  const answered = completed.length;
  const averageReaction = answered ? completed.reduce((sum, answer) => sum + (answer.reactionTimeMs || 0), 0) / answered : 0;
  const averageDuration = answered ? completed.reduce((sum, answer) => sum + (answer.answerDurationMs || 0), 0) / answered : 0;
  const changes = answers.reduce((sum, answer) => sum + (answer.answerChanges || 0), 0);
  const audioCount = answers.reduce((sum, answer) => sum + (answer.audioPlayCount || 0), 0);
  const skippedCount = answers.filter((answer) => answer.skipped).length;
  $('dashboard').innerHTML = [
    ['已完成题数', `${answered} / ${activeQuestions.length}`],
    ['跳过题数', `${skippedCount}`],
    ['未作答题数', `${activeQuestions.length - answered - skippedCount}`],
    ['平均反应时间', formatDuration(averageReaction)],
    ['平均答题耗时', formatDuration(averageDuration)],
    ['选项修改次数', `${changes}`],
    ['题干播放次数', `${audioCount}`],
    ['记录状态', storageFailure ? '有保存警告' : '已逐题保存']
  ].map(([label, value]) => `<div class="metric"><strong>${label}</strong><span>${value}</span></div>`).join('');
}

async function finalizeSessionLog() {
  await Promise.all([...eventWritePromises]);
  await opfsWriteQueue;
  await directoryWriteQueue;
  if (!sessionId || !logDb) return [];
  const events = await idbGetSessionEvents(sessionId);
  if (directoryHandle) {
    try {
      const filename = directoryLogFileName || `${safeFilePart(patient)}_${sessionId}.jsonl`;
      const target = await directoryHandle.getFileHandle(filename, { create: true });
      const writable = await target.createWritable();
      await writable.write(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
      await writable.close();
      $('saveStatus').textContent = `实时日志已保存到：${directoryHandle.name}/${filename}`;
    } catch (error) {
      setStorageStatus(`自定义日志文件最终写入失败；本机记录仍已保存。${error?.message || error}`, 'error');
    }
  }
  if (opfsLogDirectory) {
    try {
      const manifest = await opfsLogDirectory.getFileHandle(`${sessionId}-manifest.json`, { create: true });
      const writable = await manifest.createWritable();
      await writable.write(JSON.stringify({ sessionId, patient, age: patientAge || null, preset: planLabel(), events }, null, 2));
      await writable.close();
    } catch (error) {
      console.warn('OPFS 最终清单写入失败。', error);
    }
  }
  return events;
}

/* 做完后先给患者看“评估结束，请把设备还给医生”，医生长按才看到结果；从部分菜单手动结束时直接出结果 */
async function finish({ cover = true } = {}) {
  if (advanceTimer) window.clearTimeout(advanceTimer);
  advanceTimer = null;
  clearSequenceTimer();
  stopSpeaking();
  await Promise.all([...eventWritePromises]);
  const completedAt = new Date().toISOString();
  try {
    await updateSessionRecord({ completedAt, status: 'completed', answerCount: answers.length });
  } catch (error) {
    reportStorageFailure(error, '测试完成记录');
  }
  await writeEvent({ type: 'session_completed', completedAt, answerCount: answers.length });
  try { await finalizeSessionLog(); } catch (error) { reportStorageFailure(error, '日志整理'); }
  showResults();
  if (cover) showEndCover();
}

const endCoverHoldMs = 1500;
function showEndCover() {
  $('endCover').classList.remove('hidden');
  updateHomeButton();
}

function hideEndCover() {
  $('endCover').classList.add('hidden');
  updateHomeButton();
}

(function setupEndCover() {
  const button = $('endCoverOpen');
  let timer = null;
  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
    button.classList.remove('holding');
  };
  button.style.setProperty('--hold-ms', `${endCoverHoldMs}ms`);
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    cancel();
    button.classList.add('holding');
    timer = window.setTimeout(() => { cancel(); hideEndCover(); }, endCoverHoldMs);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => button.addEventListener(type, cancel));
  button.addEventListener('contextmenu', (event) => event.preventDefault());
})();

/* 在原记录上合并，保留 plan / ageBand 等恢复测试要用的字段 */
async function updateSessionRecord(patch) {
  const existing = (await idbGet('sessions', sessionId)) || {};
  await idbPut('sessions', {
    ...existing,
    id: sessionId,
    patient,
    age: patientAge || null,
    ...patientProfile(),
    preset: planLabel(),
    startedAt: new Date(sessionStartedAt).toISOString(),
    ...patch
  });
}

function showResults() {
  $('endCover').classList.add('hidden');
  $('setup').classList.add('hidden');
  $('quiz').classList.add('hidden');
  $('done').classList.remove('hidden');
  updateHomeButton();
  const open = activeQuestions.filter((question, index) => !answerByQuestion[index]).length;
  $('doneTitle').textContent = open ? `测试结果（还有 ${open} 题未作答）` : '答题完成';
  const profileText = [patientName, patientGender, patientAge ? `${patientAge} 岁` : '', patientOccupation].filter(Boolean).join('，');
  $('summary').textContent = `患者 ${patient}${profileText ? `（${profileText}）` : ''}${education ? ` · ${education}` : ''}${lettersFamiliar === 'no' ? ' · 不熟悉英文字母' : ''} · ${new Date(sessionStartedAt).toLocaleString('zh-CN')} · 共 ${activePlan.length} 个部分 / ${activeQuestions.length} 题${ageBand && activeQuestions.some((question) => question.ageBand) ? ` · 名人题${ageBand === 'young' ? '18–30 岁版' : '31–60 岁版'}` : ''}`;
  renderSectionResults();
  renderDashboard();
  renderTaskExports();
  $('logPath').textContent = directoryHandle
    ? `实时日志路径：${directoryHandle.name}/${directoryLogFileName}`
    : `实时日志路径：本机离线存储 / ScalePad-logs / ${sessionId}（完成后可导出到“下载”或自定义位置）`;
}

function patientProfile() {
  return { name: patientName || null, gender: patientGender || null, occupation: patientOccupation || null };
}

async function download(extension, type) {
  const events = sessionId && logDb ? await idbGetSessionEvents(sessionId) : sessionEventCache;
  const stats = sectionStats();
  const data = {
    schemaVersion: 4,
    sessionId,
    patient,
    age: patientAge || null,
    ...patientProfile(),
    ageBand,
    epilepsy,
    education,
    lettersFamiliar,
    adaptive: activePlan.some((step) => step.adaptive), /*@A*/
    skipReasons: Object.fromEntries(skipReasons),
    markLabels,
    preset: planLabel(),
    plan: activePlan,
    startedAt: sessionStartedAt ? new Date(sessionStartedAt).toISOString() : null,
    completedAt: new Date().toISOString(),
    sections: stats,
    answers,
    events
  };
  const describe = (answer) => {
    const question = activeQuestions[answer.questionIndex];
    if (!question) return ['', '', ''];
    if (answer.skipped) return ['', '', question.correct ?? ''];
    if (answer.adaptiveCredited) return ['1', '', question.correct ?? '']; /*@A*/
    if (question.scoring === 'scale') return ['', String(scaleScore(question, answer.answer)), ''];
    if (question.scoring === 'record' || question.scoring === 'task') return ['', '', ''];
    if (answer.mark === '3' || isUnseen(question, answer) || (question.scoring === 'manual' && !answer.mark)) return ['', '', question.correct ?? ''];
    return [recordCorrect(question, answer) ? '1' : '0', '', question.correct ?? ''];
  };
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const answerRows = answers.map((answer) => {
    const [correct, score, expected] = describe(answer);
    return [patient, patientName, patientGender, patientAge, patientOccupation, ageBand, education, lettersFamiliar, planLabel(), answer.questionIndex, answer.section, answer.question, answer.answer, answer.mark, answer.markLabel, expected, correct, score,
      answer.skipCode, answer.skipReason, answer.skipNote || '', answer.time, answer.answerDurationMs, answer.confirmationDelayMs, answer.reactionTimeMs, answer.answerChanges, answer.audioPlayCount, answer.adaptiveCredited ? '1' : '', answer.adaptiveStopped ? '1' : '', activeQuestions[answer.questionIndex]?.hard ? '1' : ''].map(quote).join(','); /*@A*/
      //@E answer.skipCode, answer.skipReason, answer.skipNote || '', answer.time, answer.answerDurationMs, answer.confirmationDelayMs, answer.reactionTimeMs, answer.answerChanges, answer.audioPlayCount].map(quote).join(',');
  });
  const statRows = stats.map((group) => [`${group.code} 部分`, group.name, group.scoring, group.correct, group.answered, group.uncertain, group.unseen, group.skipped, formatSkipCodes(group.skipCodes), group.total, group.score, group.credited, group.stopped].map(quote).join(',')); /*@A*/
  //@E const statRows = stats.map((group) => [`${group.code} 部分`, group.name, group.scoring, group.correct, group.answered, group.uncertain, group.unseen, group.skipped, formatSkipCodes(group.skipCodes), group.total, group.score].map(quote).join(','));
  const content = type === 'json'
    ? JSON.stringify(data, null, 2)
    : '\uFEFFpatient,name,gender,age,occupation,ageBand,education,lettersFamiliar,preset,questionIndex,section,question,answer,mark,markLabel,expected,correct,score,skipCode,skipReason,skipNote,time,answerDurationMs,confirmationDelayMs,reactionTimeMs,answerChanges,audioPlayCount,adaptiveCredited,adaptiveStopped,hardItem\n' /*@A*/
    //@E : '\uFEFFpatient,name,gender,age,occupation,ageBand,education,lettersFamiliar,preset,questionIndex,section,question,answer,mark,markLabel,expected,correct,score,skipCode,skipReason,skipNote,time,answerDurationMs,confirmationDelayMs,reactionTimeMs,answerChanges,audioPlayCount\n'
      + answerRows.join('\n')
      + '\n\n类型,分区,评分方式,答对,已答,标记不确定,没见过,跳过,跳过代码,总题数,量表总分,自适应计为正确,自适应停止跳过\n' /*@A*/
      //@E + '\n\n类型,分区,评分方式,答对,已答,标记不确定,没见过,跳过,跳过代码,总题数,量表总分\n'
      + statRows.join('\n');
  const filename = `${safeFilePart(patient)}_${sessionId || Date.now()}.${extension}`;
  const mime = type === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';
  await saveFile(filename, content, mime, type === 'json' ? 'JSON 文件' : 'CSV 文件', extension);
}

/* 依次尝试：自定义文件夹 → 系统保存面板 → 分享面板（iPad）→ 浏览器下载 */
async function saveFile(filename, content, mime, description, extension) {
  const file = new File([content], filename, { type: mime });

  if (directoryHandle) {
    try {
      const target = await directoryHandle.getFileHandle(filename, { create: true });
      const writable = await target.createWritable();
      await writable.write(content);
      await writable.close();
      $('saveStatus').textContent = `已保存到：${directoryHandle.name}/${filename}`;
      return;
    } catch (error) {
      directoryHandle = null;
      $('saveStatus').textContent = '无法写入所选文件夹，已改用系统文件面板或下载';
    }
  }

  if (window.showSaveFilePicker) {
    try {
      const target = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description, accept: { [mime.split(';')[0]]: [`.${extension}`] } }]
      });
      const writable = await target.createWritable();
      await writable.write(content);
      await writable.close();
      $('saveStatus').textContent = `已保存：${filename}`;
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: 'BIP评估答题记录', files: [file] });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }

  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  $('logPath').textContent = `已请求下载：${filename}。请在“下载”中确认文件（iPad 在“文件”App 里）。`;
}

/* 用 start-scalepad-desktop.command 在电脑上运行时，serve_local.py 提供 /api/merge，
 * 可一键把任务结果追加进 numerical cognition 汇总表；iPad 上没有这个接口，只显示导出按钮。 */
const mergeDestKey = 'scalepad_merge_dest_v1';
let desktopHelper = null;
fetch('/api/desktop', { cache: 'no-store' })
  .then((response) => (response.ok ? response.json() : null))
  .then((info) => { if (info?.ok) { desktopHelper = info; renderTaskExports(); } })
  .catch(() => {});

async function mergeTaskResult(filename, blob) {
  let dest = desktopHelper.dest;
  try { dest = localStorage.getItem(mergeDestKey) || dest; } catch (error) { /* 忽略 */ }
  dest = window.prompt('追加到哪个文件夹？（可改成某位患者的文件夹）', dest);
  if (dest === null) return;
  try { localStorage.setItem(mergeDestKey, dest.trim()); } catch (error) { /* 忽略 */ }
  try {
    const response = await fetch(`/api/merge?name=${encodeURIComponent(filename)}&dest=${encodeURIComponent(dest.trim())}`, { method: 'POST', body: blob });
    const result = await response.json();
    $('saveStatus').textContent = result.message;
    window.alert(result.ok ? `已追加：${result.message}` : `追加失败：${result.message}`);
  } catch (error) {
    window.alert(`追加失败：连不上本机服务（start-scalepad-desktop.command 的窗口是否已关闭？）\n${error.message || error}`);
  }
}

/* 认知任务按原程序格式导出 xlsx：一个 sheet，名为完成时间；Mac 上用 tools/merge_numerical_xlsx.py 追加进汇总表 */
function renderTaskExports() {
  const box = $('taskExports');
  box.innerHTML = '';
  answers.filter((record) => record.taskResult && !record.skipped).forEach((record) => {
    const result = record.taskResult;
    const prefix = result.workbookName.replace('_results.xlsx', '');
    const filename = `${prefix}_${safeFilePart(patient)}_${result.sheetName}.xlsx`;
    const workbook = () => window.ScalePadTasks.workbookBlob(result);
    if (desktopHelper) {
      const merge = document.createElement('button');
      merge.type = 'button';
      merge.className = 'small';
      merge.textContent = `${result.title}：追加进汇总表`;
      merge.onclick = () => { void mergeTaskResult(filename, workbook()); };
      box.append(merge);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'small';
    button.textContent = `导出${result.title}（xlsx）`;
    button.onclick = () => {
      void saveFile(filename, workbook(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel 文件', 'xlsx');
    };
    box.append(button);
  });
  box.classList.toggle('hidden', !box.children.length);
}

$('csv').onclick = () => download('csv', 'csv');
$('json').onclick = () => download('json', 'json');
$('again').onclick = () => { void startNextPatient(); };
$('resumeQuiz').onclick = () => { void resumeQuiz(); };
void renderRecentSessions();

/* 医生用键盘操作：
 * A 上一题、D 下一题、W 上一部分、S 下一部分（← → 也可以上一题 / 下一题）：按一下就切换，可以快速翻题；
 * 1 / 2 / 3 标记对错：按一下就生效（名人面孔识别里 3 = 没见过），主键盘或小键盘都行；
 * 长按 Q（约 0.6 秒）= 001 过于简单、长按 E = 002 太难，直接跳过本题；
 * 长按空格打开“跳过”菜单，按 1–6 选代码、可写备注（Esc 关闭）——会记入结果，所以要长按防误触；
 * 示例 / 提示页上 Enter 或 D 开始（示例要看满 5 秒）。
 * 光标在回答框里时按键照常输入，按 Esc 或点空白处离开回答框后再按。 */
const keyHoldMs = 600;
const navKeys = {
  KeyA: () => goPrevQuestion(),
  ArrowLeft: () => goPrevQuestion(),
  KeyD: () => goNextQuestion(),
  ArrowRight: () => goNextQuestion(),
  KeyW: () => goPart(-1),
  KeyS: () => goPart(1)
};
/* 长按 Q = 001 过于简单，长按 E = 002 太难，直接跳过本题；长按空格打开跳过菜单（其他代码、备注） */
const quickSkipKeys = { KeyQ: '001', KeyE: '002' };
const skipKeys = new Set(['KeyQ', 'KeyE', 'Space']);
const digitKey = (code) => (/^(Digit|Numpad)([1-9])$/.exec(code) || [])[2] || '';
let keyHold = null;
let keyHintTimer = null;

function showKeyHint(text, holding = false) {
  const hint = $('keyHint');
  hint.textContent = text;
  hint.classList.remove('hidden');
  hint.classList.toggle('holding', holding);
  if (holding) {
    hint.style.setProperty('--hold-ms', `${keyHoldMs}ms`);
    void hint.offsetWidth;
  }
  if (keyHintTimer) window.clearTimeout(keyHintTimer);
  keyHintTimer = holding ? null : window.setTimeout(() => hint.classList.add('hidden'), 1400);
}

function cancelKeyHold(message) {
  if (!keyHold) return;
  window.clearTimeout(keyHold.timer);
  keyHold = null;
  if (message) showKeyHint(message);
  else $('keyHint').classList.add('hidden');
}

/* 跳过菜单打开时：1–6 选原因，Esc 关闭 */
function skipMenuKey(event) {
  if (event.key === 'Escape') { closeSkipMenu(); return; }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const digit = digitKey(event.code);
  const reason = digit ? skipReasons[Number(digit) - 1] : null;
  if (!reason || event.repeat) return;
  event.preventDefault();
  void skipQuestions(reason[0]);
}

document.addEventListener('keydown', (event) => {
  if ($('quiz').classList.contains('hidden') || document.querySelector('.task-stage') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!$('skipOverlay').classList.contains('hidden')) { skipMenuKey(event); return; }
  if (!$('partsOverlay').classList.contains('hidden')) return;
  const target = event.target;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    if (event.key === 'Escape') target.blur();
    return;
  }
  if (isGated() && event.key === 'Enter') {
    event.preventDefault();
    if (!event.repeat) startGate();
    return;
  }
  if (navKeys[event.code]) {
    event.preventDefault();
    if (!event.repeat) void navKeys[event.code]();
    return;
  }
  if (skipKeys.has(event.code)) {
    event.preventDefault();
    if (event.repeat || keyHold || isGated()) return;
    const quickCode = quickSkipKeys[event.code];
    const keyName = event.code === 'Space' ? '空格' : event.code.slice(3);
    showKeyHint(quickCode ? `按住 ${keyName}：跳过本题（${quickCode}）` : `按住 ${keyName}：跳过…`, true);
    keyHold = {
      code: event.code,
      timer: window.setTimeout(() => {
        keyHold = null;
        if (quickCode) {
          showKeyHint(`已跳过（${quickCode}）`);
          skipScope = 'one';
          $('skipNote').value = '';
          void skipQuestions(quickCode);
        } else {
          $('keyHint').classList.add('hidden');
          openSkipMenu();
        }
      }, keyHoldMs)
    };
    return;
  }
  const digit = digitKey(event.code);
  if (!digit || isGated()) return;
  /* 名人比较题：3 = 有人不认识 */
  const button = document.querySelector(`#choices .mark[data-key="${digit}"]`) || (digit === '3' ? document.querySelector('#choices .unseen-option') : null);
  if (!button) return;
  event.preventDefault();
  if (!event.repeat) button.click();
});

/* 空格松开时浏览器会“点”一下当前聚焦的按钮，这里拦掉 */
document.addEventListener('keyup', (event) => {
  if (skipKeys.has(event.code) && !$('quiz').classList.contains('hidden') && !document.querySelector('.task-stage')) {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) event.preventDefault();
  }
  if (keyHold && keyHold.code === event.code) cancelKeyHold('跳过要长按才生效');
});
window.addEventListener('blur', () => cancelKeyHold());
