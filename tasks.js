/* 数轴实验 / 点数比较实验：复刻 ~/Desktop/project 里的 PsychoPy 程序（数轴实验.py、点数比较实验.py）。
 * 流程、参数、计分和 xlsx 输出格式都照原程序，不要随手“修正”，否则和已有数据对不上：
 *   - 数轴：正确位置 = -300 + (数字-1)*6（100 对应 294，不是线端 300），总分 = 100*(1-总偏差/(600*题数))
 *   - 点数：每题限时 10 秒（原指导语写 5 秒，代码是 10 秒）；比值与 1 相差 ≤0.10 的题选哪边都算对
 * 坐标沿用原程序 800×600 窗口的像素坐标（中心为原点，y 向上）。
 * 物理尺寸：原程序在 27 寸 2560×1440 显示器上跑，数轴 600 px ≈ 14.0 cm；这里按同样的物理长度画。 */
(function () {
  const STAGE_W = 800;
  const STAGE_H = 600;
  const LINE_PX = 600;
  const LINE_CM = 14.01;
  const pxPerCmKey = 'scalepad_px_per_cm_v1';
  const touchDevice = navigator.maxTouchPoints > 1;
  /* iPad（mini 以外）每英寸 132 个 CSS 像素；电脑浏览器按 96 dpi 估计，都可在“更多设置”里用尺子校准 */
  const defaultPxPerCm = (touchDevice ? 132 : 96) / 2.54;
  const FONT = '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

  function pxPerCm() {
    try {
      const saved = Number(localStorage.getItem(pxPerCmKey));
      if (saved > 10 && saved < 200) return saved;
    } catch (error) { /* 读不到就用默认值 */ }
    return defaultPxPerCm;
  }

  function setPxPerCm(value) {
    try { localStorage.setItem(pxPerCmKey, String(value)); } catch (error) { /* 忽略 */ }
  }

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve(performance.now())));
  const shuffle = (items) => {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };
  const uniform = (a, b) => a + (b - a) * Math.random();
  const randint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pad = (n) => String(n).padStart(2, '0');
  /* 原程序 sheet 名：datetime.now().strftime("%Y-%m-%d_%H-%M-%S") */
  const sheetStamp = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;

  /* 原尺寸放得下就按原尺寸；放不下（竖屏、iPad mini）按比例缩小并如实记录 */
  function layout() {
    const unit = (LINE_CM * pxPerCm()) / LINE_PX;
    const fit = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    const scale = Math.min(unit, fit);
    return { scale, scaled: scale < unit - 1e-6, lineCm: (LINE_PX * scale) / pxPerCm() };
  }

  class Stage {
    constructor() {
      this.root = document.createElement('div');
      this.root.className = 'task-stage';
      this.canvas = document.createElement('canvas');
      this.abortButton = document.createElement('button');
      this.abortButton.type = 'button';
      this.abortButton.className = 'task-abort';
      this.abortButton.textContent = '×';
      this.abortButton.title = '长按中止任务';
      this.root.append(this.canvas, this.abortButton);
      document.body.append(this.root);
      this.ctx = this.canvas.getContext('2d');
      this.layout = layout();
      const { scale } = this.layout;
      const dpr = window.devicePixelRatio || 1;
      this.cssScale = scale;
      this.s = scale * dpr;
      this.canvas.style.width = `${STAGE_W * scale}px`;
      this.canvas.style.height = `${STAGE_H * scale}px`;
      this.canvas.width = Math.round(STAGE_W * this.s);
      this.canvas.height = Math.round(STAGE_H * this.s);
      this.aborted = false;
      this.abortWaiters = new Set();
      this.cleanups = [];
      this.pointerTypes = new Set();
      let holdTimer = null;
      const release = () => { if (holdTimer) window.clearTimeout(holdTimer); holdTimer = null; this.abortButton.classList.remove('holding'); };
      this.abortButton.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.abortButton.classList.add('holding');
        holdTimer = window.setTimeout(() => { release(); this.abort(); }, 1500);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => this.abortButton.addEventListener(type, release));
    }

    abort() {
      this.aborted = true;
      this.abortWaiters.forEach((reject) => reject(new Error('aborted')));
      this.abortWaiters.clear();
    }

    /* 包一层：任务中途被中止时，正在等待的 Promise 立即结束 */
    guard(promise) {
      if (this.aborted) return Promise.reject(new Error('aborted'));
      return new Promise((resolve, reject) => {
        this.abortWaiters.add(reject);
        promise.then((value) => { this.abortWaiters.delete(reject); resolve(value); }, (error) => { this.abortWaiters.delete(reject); reject(error); });
      });
    }

    wait(ms) { return this.guard(sleep(ms)); }

    destroy() {
      this.cleanups.forEach((fn) => fn());
      this.root.remove();
    }

    X(x) { return (x + STAGE_W / 2) * this.s; }
    Y(y) { return (STAGE_H / 2 - y) * this.s; }

    toStage(event) {
      const rect = this.canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / this.cssScale - STAGE_W / 2;
      const y = STAGE_H / 2 - (event.clientY - rect.top) / this.cssScale;
      return { x: Math.max(-STAGE_W / 2, Math.min(STAGE_W / 2, x)), y: Math.max(-STAGE_H / 2, Math.min(STAGE_H / 2, y)) };
    }

    clear() {
      this.ctx.fillStyle = '#fff';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    line(x1, y1, x2, y2, width = 2) {
      const { ctx } = this;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = width * this.s;
      ctx.beginPath();
      ctx.moveTo(this.X(x1), this.Y(y1));
      ctx.lineTo(this.X(x2), this.Y(y2));
      ctx.stroke();
    }

    circle(x, y, radius, color) {
      const { ctx } = this;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(this.X(x), this.Y(y), radius * this.s, 0, Math.PI * 2);
      ctx.fill();
    }

    /* PsychoPy TextStim：height 为字高（pix 单位默认 20），wrapWidth 为换行宽度 */
    text(content, x, y, height = 20, wrapWidth = null) {
      const { ctx } = this;
      ctx.fillStyle = '#000';
      ctx.font = `${height * this.s}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxWidth = (wrapWidth || height * 15) * this.s;
      const lines = [];
      String(content).split('\n').forEach((paragraph) => {
        if (!paragraph) { lines.push(''); return; }
        let current = '';
        [...paragraph].forEach((char) => {
          if (ctx.measureText(current + char).width > maxWidth && current) { lines.push(current); current = char; } else current += char;
        });
        lines.push(current);
      });
      const lineHeight = height * 1.2;
      const top = y + ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((text, index) => ctx.fillText(text, this.X(x), this.Y(top - index * lineHeight)));
    }

    listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      const remove = () => target.removeEventListener(type, handler, options);
      this.cleanups.push(remove);
      return remove;
    }

    meta() {
      return {
        lineCm: Number(this.layout.lineCm.toFixed(2)),
        targetLineCm: LINE_CM,
        scaledDown: this.layout.scaled,
        pxPerCm: Number(pxPerCm().toFixed(3)),
        viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`,
        inputTypes: [...this.pointerTypes],
        userAgent: navigator.userAgent
      };
    }
  }

  /* ------------------- 数轴实验 ------------------- */
  const NUMBERS = [2, 4, 9, 11, 14, 17, 23, 26, 31, 38, 44, 45, 52, 59, 61, 66, 73, 78, 84, 86, 92, 99];

  /* 鼠标：红点跟随光标，按下即确认（同原程序）。
   * 触控：手指可按在数轴下方任意高度，红点落在数轴上对应的横向位置，拖动调整，抬起手指确认，避免手指挡住。 */
  function waitNumberLineClick(stage, draw) {
    return stage.guard(new Promise((resolve) => {
      let cursor = { x: 0, y: 0 };
      let touchId = null;
      let pending = false;
      const redraw = () => {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(() => { pending = false; draw(cursor); });
      };
      const removers = [];
      const done = (pos, type) => {
        removers.forEach((remove) => remove());
        stage.pointerTypes.add(type);
        resolve({ ...pos, inputType: type });
      };
      removers.push(stage.listen(stage.canvas, 'pointermove', (event) => {
        if (event.pointerType === 'mouse') { cursor = stage.toStage(event); redraw(); return; }
        if (event.pointerId !== touchId) return;
        cursor = { x: stage.toStage(event).x, y: 0 };
        redraw();
      }));
      removers.push(stage.listen(stage.canvas, 'pointerdown', (event) => {
        event.preventDefault();
        if (event.pointerType === 'mouse') {
          if (event.button !== 0) return;
          done(stage.toStage(event), 'mouse');
          return;
        }
        if (touchId !== null) return;
        touchId = event.pointerId;
        stage.canvas.setPointerCapture?.(event.pointerId);
        cursor = { x: stage.toStage(event).x, y: 0 };
        redraw();
      }));
      removers.push(stage.listen(stage.canvas, 'pointerup', (event) => {
        if (event.pointerId !== touchId) return;
        done({ x: stage.toStage(event).x, y: 0 }, event.pointerType);
      }));
      removers.push(stage.listen(stage.canvas, 'pointercancel', (event) => {
        if (event.pointerId === touchId) touchId = null;
      }));
      draw(cursor);
    }));
  }

  async function runNumberLine(stage, onTrial) {
    const numbers = shuffle([...NUMBERS]);
    const base = () => {
      stage.clear();
      stage.line(-300, 0, 300, 0, 2);
      stage.text('1', -300, -30);
      stage.text('100', 300, -30);
    };
    stage.clear();
    stage.text('欢迎参加数字线标记评估！\n\n请将鼠标移动到数字线上，标记出数字对应的位置。\n点击鼠标确认位置。\n\n即将开始，请做好准备。', 0, 0, 30, 600);
    await stage.wait(5000);
    const results = [];
    for (const number of numbers) {
      base();
      await stage.wait(1000);
      const draw = (cursor) => {
        base();
        stage.text(String(number), 0, 100);
        stage.circle(cursor.x, cursor.y, 5, '#ff0000');
      };
      draw({ x: 0, y: 0 });
      const startTime = await nextFrame();
      const pos = await waitNumberLineClick(stage, draw);
      const reactionTime = performance.now() - startTime;
      /* 原程序 mouse.getPos() 在 pix 单位下是整数像素 */
      const selected = Math.round(pos.x);
      const correctPosition = -300 + (number - 1) * 6;
      const deviation = Math.abs(selected - correctPosition);
      const trial = { number, selectedPosition: selected, correctPosition, deviation, reactionTimeMs: reactionTime, inputType: pos.inputType };
      results.push(trial);
      onTrial?.(trial, results.length - 1);
      stage.clear();
      stage.text('请确认位置', 0, -100);
      await stage.wait(1000);
    }
    const totalError = results.reduce((sum, trial) => sum + trial.deviation, 0);
    const totalRT = results.reduce((sum, trial) => sum + trial.reactionTimeMs, 0);
    const accuracy = 100 * (1 - totalError / (600 * results.length));
    stage.clear();
    await stage.wait(500);
    stage.text(`准确性评分: ${accuracy.toFixed(2)}/100\n总反应时间: ${totalRT.toFixed(0)} 毫秒`, 0, 0, 40, 600);
    await stage.wait(5000);
    const sheetName = sheetStamp();
    return {
      task: 'numberline',
      title: '数轴实验',
      workbookName: '数轴实验_results.xlsx',
      sheetName,
      accuracy,
      totalResponseTimeMs: totalRT,
      trials: results,
      rows: [
        ['总分（准确性评分）', `${accuracy.toFixed(2)}/100`],
        ['总反应时间（毫秒）', totalRT.toFixed(0)],
        [],
        ['数字', '选择位置', '正确位置', '偏差值', '反应时间（毫秒）'],
        ...results.map((trial) => [trial.number, trial.selectedPosition, trial.correctPosition, trial.deviation, trial.reactionTimeMs])
      ]
    };
  }

  /* ------------------- 点数比较实验 ------------------- */
  const DOT_TRIALS = 20;
  const RATIOS = [0.63, 0.75, 0.88];
  const ERROR_MARGIN = 0.10;
  const RESPONSE_LIMIT_MS = 10000;

  /* 键盘 ←/→ 同原程序；触屏或鼠标点屏幕左半边 = 左，右半边 = 右 */
  function waitDotChoice(stage) {
    return stage.guard(new Promise((resolve) => {
      const removers = [];
      const done = (response, type) => {
        removers.forEach((remove) => remove());
        window.clearTimeout(timer);
        if (type) stage.pointerTypes.add(type);
        resolve({ response, inputType: type || null });
      };
      const timer = window.setTimeout(() => done(null, null), RESPONSE_LIMIT_MS);
      removers.push(stage.listen(window, 'keydown', (event) => {
        if (event.repeat) return;
        if (event.key === 'ArrowLeft') done('left', 'keyboard');
        if (event.key === 'ArrowRight') done('right', 'keyboard');
      }));
      removers.push(stage.listen(stage.root, 'pointerdown', (event) => {
        if (event.target === stage.abortButton) return;
        event.preventDefault();
        done(event.clientX < window.innerWidth / 2 ? 'left' : 'right', event.pointerType);
      }));
    }));
  }

  function dotAccuracy(results) {
    let correct = 0;
    let total = 0;
    results.forEach((trial) => {
      if (!trial.response) return;
      const ratio = Math.min(trial.leftNumber, trial.rightNumber) / Math.max(trial.leftNumber, trial.rightNumber);
      if (Math.abs(ratio - 1) <= ERROR_MARGIN) correct += 1;
      else correct += trial.isCorrect ? 1 : 0;
      total += 1;
    });
    return total > 0 ? (correct / total) * 100 : 0;
  }

  async function runDotComparison(stage, onTrial) {
    stage.clear();
    ['欢迎参加非符号数量比较评估！', '屏幕上会显示两组点图，请判断哪一组的点数更多。', '使用键盘上的左箭头（←）选择左侧，', '右箭头（→）选择右侧。', '每道题的选择时间为5秒，', '若超时则自动跳转下一题。', '即将开始，请做好准备。']
      .forEach((line, index) => stage.text(line, 0, 200 - index * 50, 30, 800));
    await stage.wait(5000);
    const results = [];
    let totalRT = 0;
    for (let i = 0; i < DOT_TRIALS; i += 1) {
      const ratio = RATIOS[Math.floor(Math.random() * RATIOS.length)];
      const baseNumber = randint(10, 16);
      const compareNumber = Math.trunc(baseNumber / ratio);
      const [leftNumber, rightNumber] = Math.random() < 0.5 ? [baseNumber, compareNumber] : [compareNumber, baseNumber];
      const leftDots = Array.from({ length: leftNumber }, () => [uniform(-300, -100), uniform(-200, 200)]);
      const rightDots = Array.from({ length: rightNumber }, () => [uniform(100, 300), uniform(-200, 200)]);
      stage.clear();
      [...leftDots, ...rightDots].forEach(([x, y]) => stage.circle(x, y, 5, '#000'));
      const startTime = await nextFrame();
      const { response, inputType } = await waitDotChoice(stage);
      const responseTime = performance.now() - startTime;
      totalRT += responseTime;
      const correctResponse = leftNumber > rightNumber ? 'left' : 'right';
      const isCorrect = response ? response === correctResponse : null;
      const trial = { leftNumber, rightNumber, response, correctResponse, isCorrect, responseTimeMs: responseTime, ratio, inputType, leftDots, rightDots };
      results.push(trial);
      onTrial?.(trial, i);
    }
    const accuracy = dotAccuracy(results);
    stage.clear();
    stage.text(`准确性评分: ${accuracy.toFixed(2)}/100\n总反应时间: ${totalRT.toFixed(0)} 毫秒`, 0, 0, 40, 800);
    await stage.wait(5000);
    const sheetName = sheetStamp();
    return {
      task: 'dots',
      title: '点数比较实验',
      workbookName: '点数实验_results.xlsx',
      sheetName,
      accuracy,
      totalResponseTimeMs: totalRT,
      trials: results,
      rows: [
        ['总分（准确性评分）', `${accuracy.toFixed(2)}/100`],
        ['总反应时间（毫秒）', totalRT.toFixed(0)],
        [],
        ['左侧点数', '右侧点数', '选择', '正确答案', '是否正确', '反应时间（毫秒）'],
        /* 是否正确：1 对，0 错，2 超时未答（同原程序） */
        ...results.map((trial) => [trial.leftNumber, trial.rightNumber, trial.response, trial.correctResponse, trial.isCorrect === true ? 1 : trial.isCorrect === false ? 0 : 2, trial.responseTimeMs])
      ]
    };
  }

  const runners = { numberline: runNumberLine, dots: runDotComparison };

  /* 全屏运行一个任务；中止时 reject(Error('aborted'))，并附带已完成的试次 */
  async function run(task, { onTrial } = {}) {
    const runner = runners[task];
    if (!runner) throw new Error(`未知任务：${task}`);
    const stage = new Stage();
    try {
      const result = await runner(stage, onTrial);
      return { ...result, meta: stage.meta() };
    } finally {
      stage.destroy();
    }
  }

  function workbookBlob(result) {
    return window.ScalePadXlsx.buildWorkbook(result.sheetName, result.rows);
  }

  window.ScalePadTasks = { run, workbookBlob, layout, pxPerCm, setPxPerCm, LINE_CM };
})();
