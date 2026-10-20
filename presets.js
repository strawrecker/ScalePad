/* ScalePad 题库
 * 每道题产出：{ section 分区, sectionIntro 分区指导语, text 题干, display 屏幕显示,
 *              audioText 朗读文本, options 选项, response, correct 正确答案,
 *              scoring 'auto'|'manual'|'scale', values 量表分值, image, ageBand,
 *              delivery 'audio' 纯语音题, sequence 先黑点后箭头的刺激序列, needsLetters 需要认识英文字母 }
 * delivery 为 'audio' 的题屏幕上不出现题目，只提示“请把设备交给医生”，由医生照着读题。
 * 排序：需要医生判断对错的口答分区、医生读题的分区都排在最前面，之后才是患者自己点选的分区。
 */

const splitPair = (value) => value.split(/\s*\/\s*/).map((part) => part.trim());

const comparisonNames = (value) => {
  const match = value.match(/[:：]\s*([^/（(]+?)\s*\/\s*([^（(]+?)(?:\s*[（(]|$)/);
  return match ? [match[1].trim(), match[2].trim()] : splitPair(value);
};

/* 二选一：屏幕只显示一句短提问，两个选项按钮就是两个备选对象 */
const pickTwo = (item, firstIsCorrect, prompt) => {
  const [first, second] = splitPair(item);
  return {
    text: prompt,
    display: prompt,
    audioText: `${first}，还是${second}？${prompt}`,
    options: [first, second],
    correct: firstIsCorrect ? first : second
  };
};

const clockOptions = ['都在左侧', '都在右侧', '一左一右'];
const heightOptions = ['高 / 长', '矮 / 扁'];
/* 名人比较题的第三个按钮：有人不认识时点它，这题不计入正确率 */
const unseenOption = '有人不认识';
const clockCorrect = (answer) => (answer === '左' ? '都在左侧' : answer === '右' ? '都在右侧' : '一左一右');

const builders = {
  animalSize: (item, answer) => pickTwo(item, answer !== '大', '哪个体型更大？'),
  objectSize: (item, answer) => pickTwo(item, answer === '1', '哪个体积更大？'),
  colorCompare: (item, answer) => pickTwo(item, answer === '1', '哪个颜色更浅？'),
  cityWest: (item, answer) => pickTwo(item, answer === '1', '哪个城市在武汉的西边（地图左边）？'),

  earShape: (item) => ({
    text: `${item}的耳朵是圆的还是尖的？`,
    audioText: `请想象${item}的耳朵，是圆的还是尖的？`
  }),
  earShapeImage: () => ({
    text: '图中动物的耳朵是圆的还是尖的？',
    audioText: '这个动物的耳朵是圆的还是尖的？'
  }),
  shapeDiff: (item) => {
    const [first, second] = splitPair(item);
    return {
      text: `${first}和${second}长得有什么不一样？`,
      audioText: `请想象${first}和${second}，它们长得有什么不一样？`
    };
  },
  /* 选项写成“高 / 长”“矮 / 扁”，长条形、扁平形的东西也好回答 */
  objectHeight: (item, answer) => ({
    text: `${item}是高（长）的，还是矮（扁）的？`,
    audioText: `请想象${item}，它是高的、长的，还是矮的、扁的？`,
    options: heightOptions,
    correct: answer === '高' ? heightOptions[0] : heightOptions[1]
  }),
  typicalColor: (item) => ({
    text: `${item}一般是什么颜色？`,
    audioText: `请想象${item}，它一般是什么颜色？`
  }),
  digitCurve: (item) => ({
    text: `数字 ${item} 有弯曲的地方吗？`,
    display: '',
    audioText: `请想象数字${item}的写法，它有弯曲的地方吗？`
  }),
  digitLoop: (item) => ({
    text: `数字 ${item} 有闭环吗？`,
    display: '',
    audioText: `请想象数字${item}的写法，它有闭环吗？`
  }),
  /* 字母构建：照原版量表的口头指示原文，不改写 */
  letterBuild: (item) => ({
    text: item,
    display: '',
    audioText: item
  }),
  hanziStructure: (item) => ({
    text: `汉字“${item}”属于左右结构、上下结构，还是独体结构？`,
    display: '',
    audioText: `请想象汉字“${item}”的写法，它属于左右结构、上下结构，还是独体结构？`
  }),
  hanziDot: (item) => ({
    text: `汉字“${item}”带点“、”吗？`,
    display: '',
    audioText: `请想象汉字“${item}”的写法，它里面带点吗？`
  }),
  wordStructure: (item) => ({
    text: `词语“${item}”中有几个字属于左右结构？`,
    display: '',
    audioText: `请想象词语“${item}”的写法，其中有几个字属于左右结构？`
  }),
  celebrity: (item, answer) => {
    const names = comparisonNames(item);
    const detail = item.match(/[（(]([^）)]*)[）)]/)?.[1]?.trim() || '谁更符合';
    const asked = detail.includes('谁') ? detail : `${detail}的是谁`;
    const prompt = asked.endsWith('？') ? asked : `${asked}？`;
    return {
      text: prompt,
      display: prompt,
      audioText: `请想象${names[0]}和${names[1]}的面孔。${prompt}`,
      options: [...names, unseenOption],
      unseenOption,
      correct: answer === '1' ? names[0] : names[1]
    };
  },
  spatial: () => ({
    text: '箭头是否指向其中一个点？',
    audioText: '箭头是否指向其中一个点？'
  }),
  /* 先显示黑点几秒，黑点消失后只留箭头，凭记忆判断 */
  spatialSequence: () => ({
    text: '箭头有没有指向刚才某个黑点的位置？',
    audioText: '箭头有没有指向刚才某个黑点的位置？'
  }),
  clockImagery: (item, answer) => ({
    text: `想象 ${item} 的钟面，时针和分针位于哪一侧？`,
    audioText: `请想象${item}的钟面，时针和分针位于表盘的哪一侧？`,
    options: clockOptions,
    correct: clockCorrect(answer)
  }),
  clockImage: (item, answer) => ({
    text: '图中钟面的时针和分针位于哪一侧？',
    audioText: '这个钟面的时针和分针位于表盘的哪一侧？',
    options: clockOptions,
    correct: clockCorrect(answer)
  }),
  colorName: () => ({
    text: '这个色块是什么颜色？',
    audioText: '请说出这个色块的颜色。'
  }),
  readAloud: (item) => ({
    text: `请大声朗读：${item}`,
    display: item,
    audioText: '请大声朗读屏幕上的内容。'
  }),
  faceName: () => ({
    text: '这是哪位名人？',
    audioText: '请说出这位名人的名字。'
  })
};

/* def: { id 构造器, name 分区名, intro 指导语（{n} 会替换为本区题数）, rows, options, response, scoring, ageBand } */
const section = (id, name, intro, rows, options, response = 'choice', extra = {}) =>
  ({ id, name, intro, rows, options, response, ...extra });

const buildSection = (def) => {
  const intro = def.intro.replace('{n}', String(def.rows.length));
  return def.rows.map(([item, answer, image], index) => {
    const built = builders[def.id](item, answer, def);
    const media = Array.isArray(image) ? { sequence: { dots: image[0], arrow: image[1], dotsMs: def.dotsMs } } : image ? { image } : {};
    return {
      section: def.name,
      sectionIntro: intro,
      scoring: def.scoring || 'auto',
      response: def.response,
      options: def.response === 'text' ? [] : (built.options || def.options),
      correct: built.correct !== undefined ? built.correct : answer,
      text: built.text,
      display: built.display ?? built.text,
      audioText: built.audioText || built.text,
      ...media,
      ...(audioOnly.has(def.id) ? { delivery: 'audio' } : {}),
      ...(built.unseenOption ? { unseenOption: built.unseenOption } : {}),
      ...(def.unseenMark ? { unseenMark: true } : {}),
      ...(fullParts.has(def.id) ? { fullPart: true } : {}),
      ...(def.needsLetters ? { needsLetters: true } : {}),
      ...(def.ageBand ? { ageBand: def.ageBand } : {}),
      ...(def.hard?.includes(index + 1) ? { hard: true } : {}), /*@A*/
      ...(examples[def.id] ? { example: def.id } : {})
    };
  });
};

const withImages = (def, folder, ext = 'png') => ({
  ...def,
  rows: def.rows.map((row, index) => [...row, `${folder}/item${String(index + 1).padStart(2, '0')}.${ext}`])
});

/* 空间表征（想象版）：每题两张图，先黑点、后箭头 */
const withSequence = (def, folder) => ({
  ...def,
  dotsMs: 4000,
  rows: def.rows.map((row, index) => {
    const base = `${folder}/item${String(index + 1).padStart(2, '0')}`;
    return [...row, [`${base}-dots.svg`, `${base}-arrow.svg`]];
  })
});

/* 名人题（看图说名字、想象比较）：无论如何全部做完 */
const fullParts = new Set(['celebrity', 'faceName']);

/* 需要靠听、不能让患者看到题目的分区，由医生手持设备读题 */
const audioOnly = new Set(['digitCurve', 'digitLoop', 'letterBuild', 'hanziStructure', 'hanziDot', 'wordStructure']);
/* 患者看屏幕口答、由医生判断对错的分区 */
const doctorJudged = (def) => def.response === 'text' && !audioOnly.has(def.id);
const doctorRun = (def) => doctorJudged(def) || audioOnly.has(def.id);
/* 朗读数字、字母、词语的分区：患者要先看过这些字，才能做靠听的数字、字母、汉字题 */
const readFirst = (def) => def.id === 'readAloud';
/* 单独一卷：朗读分区 → 医生读题的分区 → 医生判断的分区 → 患者自己点选的分区 */
const doctorFirst = (defs) => [...defs.filter(readFirst), ...defs.filter((def) => audioOnly.has(def.id)), ...defs.filter((def) => doctorJudged(def) && !readFirst(def)), ...defs.filter((def) => !doctorRun(def))];
/* 感知 + 想象一套做：先朗读数字、字母、词语（看过才能做后面的听题），再做医生读题的分区，
 * 然后是其余医生判断的口答题（先感知后想象），之后患者部分里同类题挨着、先感知再想象 */
const perceptionPairs = { earShapeImage: 'earShape', spatial: 'spatialSequence', clockImage: 'clockImagery' };
const combinedSet = (perception, imagery) => {
  const paired = new Set(Object.values(perceptionPairs));
  return [
    ...perception.filter(readFirst),
    ...perception.filter((def) => audioOnly.has(def.id)),
    ...imagery.filter((def) => audioOnly.has(def.id)),
    ...perception.filter((def) => doctorJudged(def) && !readFirst(def)),
    ...imagery.filter(doctorJudged),
    ...perception.filter((def) => !doctorRun(def)).flatMap((def) => [def, ...imagery.filter((other) => other.id === perceptionPairs[def.id])]),
    ...imagery.filter((def) => !doctorRun(def) && !paired.has(def.id))
  ];
};

/* 空间、时钟题开始前先给患者看的示例（不计分），由 app.js 在本部分第一题前显示 */
const examples = {
  spatial: {
    title: '示例：箭头有没有指向某个黑点？',
    panels: [
      { image: 'assets/examples/spatial-yes.svg', answer: '是', tone: 'yes', caption: '箭头往前延长（红色虚线），碰到了一个黑点' },
      { image: 'assets/examples/spatial-no.svg', answer: '否', tone: 'no', caption: '箭头往前延长，一个黑点也没碰到' }
    ]
  },
  spatialSequence: {
    title: '示例：先记住黑点，再判断箭头',
    note: '③④ 里的灰圈 = 刚才出现过的点，只是帮你看懂，答题时屏幕上没有',
    panels: [
      { image: 'assets/examples/sequence-1.svg', caption: '① 先出现几个黑点，记住位置' },
      { image: 'assets/examples/sequence-2.svg', caption: '② 黑点消失，只剩一个箭头' },
      { image: 'assets/examples/sequence-3.svg', answer: '是', tone: 'yes', caption: '③ 箭头延长后，碰到了刚才出现过的点' },
      { image: 'assets/examples/sequence-no.svg', answer: '否', tone: 'no', caption: '④ 箭头延长后，刚才出现过的点一个也没碰到' }
    ]
  },
  clockImage: {
    title: '示例：以 12 点和 6 点的连线（虚线）分左右',
    panels: [
      { image: 'assets/examples/clock-right.svg', answer: '都在右侧', caption: '1:10：两根针都在右半边' },
      { image: 'assets/examples/clock-left.svg', answer: '都在左侧', caption: '10:45：两根针都在左半边' },
      { image: 'assets/examples/clock-split.svg', answer: '一左一右', caption: '2:35：时针在右、分针在左' }
    ]
  },
  clockImagery: {
    title: '示例：看到时间 → 想出钟面 → 判断左右',
    note: '另外两种答案：10:45 两根针都在左侧；2:35 时针在右、分针在左，是一左一右',
    panels: [
      { image: 'assets/examples/clock-time.svg', caption: '① 屏幕上出现一个时间，例如 15:05（下午 3 点 05 分）' },
      { image: 'assets/examples/clock-imagine.svg', caption: '② 在脑海里想出这个时间的钟面：时针指 3，分针指 1' },
      { image: 'assets/examples/clock-305.svg', answer: '都在右侧', caption: '③ 以 12 点和 6 点的连线分左右：两根针都在右边' }
    ]
  }
};

const withFaces = (def, folder) => ({
  ...def,
  rows: def.rows.map((row, index) => [...row, `${folder}/face${String(index + 1).padStart(2, '0')}.png`])
});

/* ---------------- 共用分区 ---------------- */

const celebrityIntro = '请想象这两位名人的面孔。不认识其中一位时点“有人不认识”。';
const spatialIntro = '先记住屏幕上几个黑点的位置，约 4 秒后黑点消失、只留一个箭头。请判断箭头有没有指向刚才某个黑点的位置。';
const cityIntro = '请想象这两个城市在中国地图上的位置。';

const celebrityYoung = section('celebrity', '名人面孔心理表征测试（18–30岁）', celebrityIntro, [
  ['脸型：岳云鹏 / 刘翔（谁的脸更圆）', '1'], ['脸型：韩红 / 武大靖（谁的脸更圆）', '1'], ['脸型：王力宏 / 朗朗（谁的脸更圆）', '2'],
  ['脸型：赵丽颖 / 舒淇（谁的脸更圆）', '1'], ['脸型：胡歌 / 吴京（谁的脸更圆）', '2'],
  ['鼻子：迪丽热巴 / 沈腾（鼻梁更高、鼻头更尖）', '1'], ['鼻子：成龙 / 吴彦祖（鼻梁更高、鼻头更尖）', '2'],
  ['眼睛：孙俪 / 那英（谁的眼睛更大）', '1'], ['眼睛：黄晓明 / 张颂文（谁的眼睛更大）', '1'], ['眼睛：全红婵 / 唐嫣（谁的眼睛更大）', '2']
], ['1', '2'], 'choice', { ageBand: 'young' });

const celebrityOlder = section('celebrity', '名人面孔心理表征测试（30–60岁）', celebrityIntro, [
  ['脸型：岳云鹏 / 刘翔（谁的脸更圆）', '1'], ['脸型：韩红 / 陈坤（谁的脸更圆）', '1'], ['脸型：王力宏 / 朗朗（谁的脸更圆）', '2'],
  ['脸型：赵丽颖 / 舒淇（谁的脸更圆）', '1'], ['脸型：胡歌 / 吴京（谁的脸更圆）', '2'],
  ['鼻子：迪丽热巴 / 沈腾（鼻梁更高、鼻头更尖）', '1'], ['鼻子：成龙 / 吴彦祖（鼻梁更高、鼻头更尖）', '2'],
  ['眼睛：孙俪 / 那英（谁的眼睛更大）', '1'], ['眼睛：黄晓明 / 李雪健（谁的眼睛更大）', '1'], ['眼睛：王祖贤 / 姚明（谁的眼睛更大）', '1']
], ['1', '2'], 'choice', { ageBand: 'older' });

const cityRows = [
  ['乌鲁木齐 / 杭州', '1'], ['昆明 / 天津', '1'], ['乌鲁木齐 / 北京', '1'], ['杭州 / 昆明', '2'], ['南京 / 桂林', '2'],
  ['青岛 / 拉萨', '2'], ['济南 / 重庆', '2'], ['三亚 / 哈尔滨', '1'], ['西双版纳 / 北京', '1'], ['天津 / 兰州', '2'],
  ['西安 / 大连', '1'], ['厦门 / 西双版纳', '2'], ['三亚 / 台北', '1'], ['兰州 / 厦门', '1'], ['上海 / 成都', '2']
];

/* ---------------- BIP A：视觉心理意象 ---------------- */

const imageryA = [
  section('animalSize', '动物比较测试', '请想象这两种动物。', [
    ['山羊 / 奶牛', '大'], ['山羊 / 中华田园犬', '小'], ['山羊 / 骆驼', '大'], ['山羊 / 蝙蝠', '小'], ['山羊 / 水獭', '小'],
    ['山羊 / 土拨鼠', '小'], ['山羊 / 鸽子', '小'], ['山羊 / 鹿', '大'], ['山羊 / 野牛', '大'], ['山羊 / 斑马', '大']
  ], ['大', '小']),

  section('earShape', '物理细节心理表征测试', '请想象这种动物的耳朵。', [
    ['熊', '圆'], ['河马', '圆'], ['狼', '尖'], ['猫', '尖'], ['熊猫', '圆'], ['山羊', '尖'], ['大猩猩', '圆'], ['大象', '圆'],
    ['驴', '尖'], ['猪', '尖'], ['狐狸', '尖'], ['猎豹', '圆'], ['长颈鹿', '尖'], ['老虎', '圆'], ['马', '尖']
  ], ['圆', '尖']),

  section('objectSize', '物体对比测试', '请想象这两样东西。', [
    ['苹果 / 火龙果', '2'], ['蝴蝶 / 瓢虫', '1'], ['凳子 / 沙发', '2'], ['鲨鱼 / 三文鱼', '1'], ['笔记本 / 便签', '1'],
    ['绿豆 / 扁豆', '2'], ['金丝雀 / 鹰', '2'], ['仓鼠 / 猴子', '2'], ['斧头 / 螺丝刀', '1'], ['柚子 / 南瓜', '2']
  ], ['1', '2']),

  section('shapeDiff', '形态辨别测试', '请想象这两样东西。', [
    ['钉子 / 螺丝', '头部没有螺丝或槽口'], ['马背 / 骆驼背', '隆起'], ['猪尾巴 / 牛尾巴', '长度或形状'], ['夹克 / 风衣', '长度'],
    ['火柴 / 牙签', '红色尖端 / 尖头'], ['煲汤锅 / 平底锅', '深度'], ['牙刷 / 梳子', '尺寸'], ['碗 / 过滤器', '洞'],
    ['自行车轮 / 汽车轮', '尺寸或轮辐'], ['桶 / 碗', '深度或内凹程度']
  ], [], 'text', { scoring: 'manual' }),

  section('objectHeight', '物体心理表征测试', '请想象这件物品。', [
    ['烟灰缸', '矮'], ['月饼', '矮'], ['矿泉水瓶', '高'], ['眼镜盒', '矮'], ['遥控器', '矮'],
    ['平底锅', '矮'], ['邮筒', '高'], ['键盘', '矮'], ['桅杆', '高'], ['热水壶', '高']
  ], heightOptions),

  section('typicalColor', '物体典型颜色回忆测试', '请想象这样东西。', [
    ['番茄酱', '红色'], ['棉花', '白色'], ['消防车', '红色'], ['羽毛球', '白色'], ['树干', '棕色'],
    ['蚂蚁', '黑色'], ['豌豆', '绿色'], ['火腿', '粉色 / 红色'], ['南瓜', '橘色'], ['原味奶茶', '浅褐色']
  ], [], 'text'),

  section('colorCompare', '色彩对比测试（第一部分）', '请想象这两样东西通常的颜色。', [
    ['西瓜皮 / 粽叶', '1'], ['向日葵花瓣 / 菠萝肉', '2'], ['原味奶茶 / 美式咖啡', '1'], ['玉米 / 食用油', '1'], ['苹果 / 火龙果', '1'],
    ['茄子 / 洋葱', '2'], ['青椒 / 青提', '2'], ['栗子壳 / 土豆皮', '2'], ['柠檬 / 水仙花', '2'], ['橡木 / 乌木', '1']
  ], ['1', '2']),

  section('colorCompare', '色彩对比测试（第二部分）', '请想象这两样东西通常的颜色。', [
    ['灰烬 / 煤', '1'], ['焦油 / 混凝土', '2'], ['铅笔芯 / 黑墨水', '1'], ['牙齿 / 雪', '2'], ['百合 / 竹笋', '1'],
    ['豆腐 / 白蘑菇', '1'], ['紫菜 / 黑木耳', '1'], ['粉笔 / 沙子', '1'], ['大米 / 山药', '2'], ['蔗糖 / 糖粉', '2']
  ], ['1', '2']),

  section('digitCurve', '个位数心理表征测试', '请听数字，想象它的写法，回答有没有弯曲的地方。', [
    ['6', '有'], ['3', '有'], ['1', '无'], ['9', '有'], ['0', '有'], ['5', '有'], ['4', '无'], ['7', '无'], ['2', '有'], ['8', '有']
  ], ['有', '无']),

  section('digitLoop', '多位数心理表征测试', '请听数字，想象它的写法，回答有没有闭环。', [
    ['2069', '有'], ['5372', '无'], ['3125', '无'], ['6908', '有'], ['1453', '无'],
    ['7514', '无'], ['8690', '有'], ['4231', '无'], ['9786', '有']
  ], ['有', '无']),

  section('letterBuild', '字母心理构建测试', '请听变换步骤，在心里拼出一个大写字母，说出是哪个字母。', [
    ['想象一个大写的V，将其颠倒过来，并在中间添加一个小水平线条。', 'A'], ['想象一个大写的 C 并转动它，使其朝上。', 'U'],
    ['想象一个大写的T，向左旋转90度，然后添加一个竖线垂直于右侧', 'H'], ['想象一个大写的 M 并删除两个竖线。', 'V'],
    ['想象一个大写的 N 并将其向右旋转90度。', 'Z'], ['想象一个大写的 F，并在其右下端添加一个小水平条。', 'E'],
    ['想象一个大写的C，并在其下端放置一个小写字母T。', 'G'], ['想象一个大写的 Q 并删除底部的右倾斜线。', 'O'],
    ['想象一个大写的 V，向右旋转90度，并在左侧添加一个垂直线条。', 'K'], ['取一个大写的 R，删除斜杠，然后将其替换为向左看的小写的 C。', 'B'],
    ['想象一个大写 T 并删除水平条。', 'I'], ['想象一个大写的 V，将其倒过来，并将另一个大写的 V 放在上面。', 'X'],
    ['想象一个大写的 B 并删除它的下半部分。', 'D']
  ], [], 'text', { needsLetters: true }),

  section('hanziStructure', '汉字心理表征测试', '请听汉字，想象它的写法，回答是左右结构、上下结构还是独体结构。', [
    ['我', '独体结构'], ['你', '左右结构'], ['它', '上下结构'], ['也', '独体结构'], ['草', '上下结构'], ['章', '上下结构'],
    ['打', '左右结构'], ['电', '独体结构'], ['气', '独体结构'], ['种', '左右结构'], ['中', '独体结构'], ['爸', '上下结构'], ['花', '上下结构']
  ], ['左右结构', '上下结构', '独体结构']),

  section('wordStructure', '词语心理表征测试', '请听词语，想象它的写法，回答其中有几个字是左右结构。', [
    ['我们', '1'], ['你们', '2'], ['大家', '0'], ['丛林', '1'], ['上海', '1'], ['夜市', '0'], ['港湾', '2'],
    ['河床', '1'], ['知道', '1'], ['路程', '2'], ['煤矿', '2'], ['电脑', '1'], ['杂草', '0']
  ], ['0', '1', '2']),

  celebrityYoung,
  celebrityOlder,

  withSequence(section('spatialSequence', '空间表征测试', spatialIntro, [
    ['1', '是'], ['2', '是'], ['3', '否'], ['4', '是'], ['5', '否'], ['6', '否'], ['7', '是'], ['8', '是'],
    ['9', '是'], ['10', '是'], ['11', '是'], ['12', '否'], ['13', '否'], ['14', '是'], ['15', '是'], ['16', '否']
  ], ['是', '否']), 'assets/spatial-seq-a'),

  section('clockImagery', '时钟测试', '请按给出的时间想象钟面，回答时针和分针都在左侧、都在右侧，还是一左一右。', [
    ['15:05', '右'], ['19:25', '两者'], ['14:05', '右'], ['21:50', '左'], ['16:15', '右'], ['10:10', '两者'], ['16:05', '右'],
    ['10:55', '左'], ['20:10', '两者'], ['19:40', '左'], ['15:10', '右'], ['16:25', '右'], ['20:50', '左'], ['14:40', '两者'], ['17:35', '两者']
  ], clockOptions),

  section('cityWest', '城市地理方位判断测试', cityIntro, cityRows, ['1', '2'])
];

/* ---------------- BIP B：视觉心理意象 ---------------- */

const imageryB = [
  section('animalSize', '动物比较测试', '请想象这两种动物。', [
    ['山羊 / 老虎', '大'], ['山羊 / 狮子', '大'], ['山羊 / 仓鼠', '小'], ['山羊 / 长颈鹿', '大'], ['山羊 / 麻雀', '小'],
    ['山羊 / 豹子', '大'], ['山羊 / 松鼠', '小'], ['山羊 / 青蛙', '小'], ['山羊 / 犀牛', '大'], ['山羊 / 兔子', '小']
  ], ['大', '小']),

  section('earShape', '物理细节心理表征测试', '请想象这种动物的耳朵。', [
    ['熊', '圆'], ['河马', '圆'], ['狼', '尖'], ['猫', '尖'], ['熊猫', '圆'], ['山羊', '尖'], ['大猩猩', '圆'], ['大象', '圆'],
    ['驴', '尖'], ['猪', '尖'], ['狐狸', '尖'], ['猎豹', '圆'], ['长颈鹿', '尖'], ['老虎', '圆'], ['马', '尖']
  ], ['圆', '尖']),

  section('objectSize', '物体对比测试', '请想象这两样东西。', [
    ['苹果手机 / 文具盒', '2'], ['钱包 / 钥匙', '1'], ['西瓜 / 冬瓜', '2'], ['鸭子 / 鸵鸟', '2'], ['汤勺 / 叉子', '1'],
    ['洋葱 / 花椰菜', '2'], ['梨 / 葡萄', '1'], ['苍蝇 / 蚊子', '1'], ['开瓶器 / 擀面杖', '2'], ['鳄鱼 / 蜥蜴', '1']
  ], ['1', '2']),

  section('shapeDiff', '形态辨别测试', '请想象这两样东西。', [
    ['橙子 / 柑橘', '尺寸'], ['鹦鹉嘴 / 喜鹊嘴', '钩状（鹦鹉）/ 尖状（喜鹊）喙或大小'], ['大白鲨 / 鲸鱼', '尾长或大小'],
    ['板凳 / 扶手椅', '椅子扶手'], ['樱桃 / 树莓', '颜色深浅'], ['基围虾 / 龙虾', '尺寸'], ['鹅掌 / 鸡爪', '有蹼 / 无蹼'],
    ['茄子 / 黄瓜', '尺寸、厚度'], ['棕熊 / 熊猫', '尺寸'], ['蛞蝓 / 蜗牛', '壳']
  ], [], 'text', { scoring: 'manual' }),

  section('objectHeight', '物体心理表征测试', '请想象这件物品。', [
    ['蜡烛', '高'], ['披萨', '矮'], ['马克杯', '矮'], ['电脑包', '矮'], ['纸巾盒', '矮'],
    ['扫帚', '高'], ['托盘', '矮'], ['尺子', '矮'], ['垃圾桶', '高'], ['苹果手机', '矮']
  ], heightOptions),

  section('typicalColor', '物体典型颜色回忆测试', '请想象这样东西。', [
    ['火烈鸟', '粉色'], ['草地', '绿色'], ['柑桔', '橘色'], ['土地', '棕色'], ['小鸡', '黄色'],
    ['面粉', '白色'], ['草莓', '红色'], ['海豚', '灰色'], ['芝麻', '黑色'], ['西瓜瓤', '红色']
  ], [], 'text'),

  section('colorCompare', '色彩对比测试（第一部分）', '请想象这两样东西通常的颜色。', [
    ['红辣椒 / 萝卜', '2'], ['菠菜 / 生菜', '2'], ['番茄 / 水蜜桃', '2'], ['栗子壳 / 核桃壳', '2'], ['香蕉肉 / 黄豆', '1'],
    ['煮熟的龙虾 / 血浆', '1'], ['青苹果 / 牛油果', '1'], ['蜂蜜 / 枫糖浆', '1'], ['巧克力 / 面包', '2'], ['柿子 / 红枣', '1']
  ], ['1', '2']),

  section('colorCompare', '色彩对比测试（第二部分）', '请想象这两样东西通常的颜色。', [
    ['灰烬 / 煤', '1'], ['焦油 / 混凝土', '2'], ['铅笔芯 / 黑墨水', '1'], ['牙齿 / 雪', '2'], ['百合 / 竹笋', '1'],
    ['豆腐 / 白蘑菇', '1'], ['紫菜 / 黑木耳', '1'], ['粉笔 / 沙子', '1'], ['大米 / 山药', '2'], ['蔗糖 / 糖粉', '2']
  ], ['1', '2']),

  section('digitLoop', '个位数心理表征测试', '请听数字，想象它的写法，回答有没有闭环。', [
    ['8', '有'], ['4', '无'], ['1', '无'], ['7', '无'], ['6', '有'], ['3', '无'], ['2', '无'], ['0', '有'], ['5', '无'], ['9', '有']
  ], ['有', '无']),

  section('digitLoop', '多位数心理表征测试', '请听数字，想象它的写法，回答有没有闭环。', [
    ['3175', '无'], ['1427', '无'], ['9286', '有'], ['2514', '无'], ['7069', '有'],
    ['8600', '有'], ['4731', '无'], ['8098', '有'], ['5342', '无']
  ], ['有', '无']),

  section('letterBuild', '字母心理构建测试', '请听变换步骤，在心里拼出一个大写字母，说出是哪个字母。', [
    ['想象一个大写的W并将其颠倒过来。', 'M'], ['想象一个大写的 E 并删除底部的小水平条。', 'F'],
    ['想象一个大写的V，并从其尖端向下添加一条竖线。', 'Y'], ['想象一个大写的 O 并在底部添加一点右倾斜线。', 'Q'],
    ['取一个大写的 O 并删除其右半部分。', 'C'], ['想象一个大写 C，并在其下方向左添加另一个大写 C。', 'S'],
    ['想象一个大写的 Z 并向左旋转90度。', 'N'], ['想象一个大写的 R 并删除小斜线。', 'P'],
    ['想象一个大写的M并将其颠倒过来。', 'W'], ['想象一个大写T，将其反转，并删除其水平横线的左侧部分。', 'L'],
    ['想象一个大写的 B，删除底部的半圆，并在其位置添加一个小线条向右倾斜。', 'R'], ['想象大写的 I，并在左下角附加一个向上看的小写 C。', 'J'],
    ['取一个大写的 H，向右旋转90度，然后去除底部的水平横线。', 'T']
  ], [], 'text', { needsLetters: true }),

  section('hanziDot', '汉字心理表征测试', '请听汉字，想象它的写法，回答里面有没有点“、”。', [
    ['醋', '无'], ['海', '有'], ['喝', '有'], ['然', '有'], ['搭', '无'], ['肠', '无'], ['吐', '无'],
    ['骂', '无'], ['好', '无'], ['蓝', '有'], ['手', '无'], ['为', '有'], ['毛', '无']
  ], ['有', '无']),

  section('wordStructure', '词语心理表征测试', '请听词语，想象它的写法，回答其中有几个字是左右结构。', [
    ['前面', '0'], ['嘴巴', '1'], ['西瓜', '0'], ['头发', '0'], ['粉刷', '2'], ['奶瓶', '2'], ['小狗', '1'],
    ['耳机', '1'], ['眼睛', '2'], ['兔子', '0'], ['轿车', '1'], ['泳池', '2'], ['月亮', '0']
  ], ['0', '1', '2']),

  celebrityYoung,
  celebrityOlder,

  withSequence(section('spatialSequence', '空间表征测试', spatialIntro, [
    ['1', '否'], ['2', '否'], ['3', '否'], ['4', '否'], ['5', '否'], ['6', '是'], ['7', '是'], ['8', '是'],
    ['9', '否'], ['10', '否'], ['11', '是'], ['12', '是'], ['13', '否'], ['14', '否'], ['15', '否'], ['16', '是']
  ], ['是', '否']), 'assets/spatial-seq-b'),

  section('clockImagery', '时钟测试', '请按给出的时间想象钟面，回答时针和分针都在左侧、都在右侧，还是一左一右。', [
    ['8:45', '左'], ['16:10', '右'], ['19:45', '左'], ['21:55', '左'], ['20:20', '两者'], ['20:55', '左'], ['11:35', '左'],
    ['17:15', '右'], ['16:40', '两者'], ['15:45', '两者'], ['17:20', '右'], ['9:15', '两者'], ['20:35', '左'], ['14:50', '两者'], ['13:25', '右']
  ], clockOptions),

  section('cityWest', '城市地理方位判断测试', cityIntro, cityRows, ['1', '2'])
];

/* ---------------- BIP：视觉感知 ---------------- */

const earImageRows = [
  ['熊', '圆'], ['河马', '圆'], ['狼', '尖'], ['猫', '尖'], ['熊猫', '圆'], ['山羊', '尖'], ['大猩猩', '圆'], ['大象', '圆'],
  ['驴', '尖'], ['猪', '尖'], ['狐狸', '尖'], ['猎豹', '圆'], ['长颈鹿', '尖'], ['老虎', '圆'], ['马', '尖']
];

const colorNameRows = [
  ['1', '蓝色'], ['2', '黄色'], ['3', '粉色'], ['4', '黑色'], ['5', '灰色'], ['6', '红色'], ['7', '绿色'],
  ['8', '紫色'], ['9', '棕色'], ['10', '白色'], ['11', '橙色'], ['12', '褐色'], ['13', '酒红色']
];

/* 字母阅读：大写、小写分成两个部分分开标记，结果里能看出只会其中一种的情况。
 * pairs 是原版的“大写 / 小写”配对，如 'Aa Uz He' */
const letterSections = (pairs) => {
  const items = pairs.split(' ');
  const rows = (pick) => items.map((pair) => [pair[pick], pair[pick]]);
  return [
    section('readAloud', '大写字母阅读测试', '请大声读出屏幕上的大写字母。', rows(0), [], 'text', { needsLetters: true }),
    section('readAloud', '小写字母阅读测试', '请大声读出屏幕上的小写字母。', rows(1), [], 'text', { needsLetters: true })
  ];
};

const singleDigitRows = [['5', '5'], ['1', '1'], ['7', '7'], ['0', '0'], ['2', '2'], ['9', '9'], ['3', '3'], ['8', '8'], ['4', '4'], ['6', '6']];

const earSection = () => withImages(section('earShapeImage', '物理细节判断测试',
  '请回答图片上动物的耳朵是圆的还是尖的。', earImageRows, ['圆', '尖']), 'assets/animal', 'jpg');

const colorSection = () => withImages(section('colorName', '颜色名称测试',
  '请说出色块的颜色。', colorNameRows, [], 'text'), 'assets/colors');

const perceptionA = [
  earSection(),
  colorSection(),
  section('readAloud', '个位数阅读测试', '请大声读出屏幕上的数字。', singleDigitRows, [], 'text'),
  section('readAloud', '多位数阅读测试', '请大声读出屏幕上的数字。', [
    ['2069', '2069'], ['5392', '5392'], ['3170', '3170'], ['6403', '6403'], ['1958', '1958'],
    ['7514', '7514'], ['8625', '8625'], ['4281', '4281'], ['9736', '9736'], ['0847', '0847']
  ], [], 'text'),
  ...letterSections('Aa Uz He Vr Zt Ey Gu Oi Ko Bp Iq Xs Dd'),
  section('readAloud', '词语阅读测试', '请大声读出屏幕上的词语。', [
    ['粉刷', '粉刷'], ['眼睛', '眼睛'], ['好奇', '好奇'], ['吃饭', '吃饭'], ['港湾', '港湾'], ['笔记', '笔记'], ['台灯', '台灯'], ['奶瓶', '奶瓶'],
    ['电梯', '电梯'], ['创新', '创新'], ['选择', '选择'], ['爱情', '爱情'], ['汉字', '汉字'], ['报纸', '报纸'], ['复习', '复习']
  ], [], 'text'),
  withFaces(section('faceName', '名人面孔识别测试（18–30岁）', '请说出图片上这位名人的名字。', [
    ['1', '吴京'], ['2', '岳云鹏'], ['3', '沈腾'], ['4', '成龙'], ['5', '那英'],
    ['6', '韩红'], ['7', '黄晓明'], ['8', '孙俪'], ['9', '赵丽颖'], ['10', '谷爱凌']
  ], [], 'text', { ageBand: 'young', unseenMark: true }), 'assets/faces-a-18'),
  withFaces(section('faceName', '名人面孔识别测试（31–60岁）', '请说出图片上这位名人的名字。', [
    ['1', '周润发'], ['2', '沈腾'], ['3', '姚明'], ['4', '岳云鹏'], ['5', '吴京'],
    ['6', '成龙'], ['7', '刘翔'], ['8', '吴彦祖'], ['9', '胡歌'], ['10', '周迅']
  ], [], 'text', { ageBand: 'older', unseenMark: true }), 'assets/faces-a-30'),
  withImages(section('spatial', '空间感知测试', '请判断箭头有没有指向图中的某个黑点。', [
    ['1', '是'], ['2', '是'], ['3', '否'], ['4', '是'], ['5', '否'], ['6', '否'], ['7', '是'], ['8', '是'],
    ['9', '是'], ['10', '是'], ['11', '是'], ['12', '否'], ['13', '否'], ['14', '是'], ['15', '是'], ['16', '否']
  ], ['是', '否']), 'assets/spatial-a'),
  withImages(section('clockImage', '时钟识别测试', '请回答钟面上的时针和分针都在左侧、都在右侧，还是一左一右。', [
    ['11:35', '左'], ['15:10', '右'], ['16:25', '右'], ['14:40', '两者'], ['20:35', '左'], ['10:10', '两者'], ['20:50', '左'], ['14:05', '右'],
    ['9:15', '两者'], ['16:40', '两者'], ['16:10', '右'], ['20:10', '两者'], ['19:45', '左'], ['19:40', '左'], ['14:50', '两者']
  ], clockOptions), 'assets/clock-a')
];

const perceptionB = [
  earSection(),
  colorSection(),
  section('readAloud', '个位数阅读测试', '请大声读出屏幕上的数字。', singleDigitRows, [], 'text'),
  section('readAloud', '多位数阅读测试', '请大声读出屏幕上的数字。', [
    ['8175', '8175'], ['1408', '1408'], ['9286', '9286'], ['3097', '3097'], ['3620', '3620'],
    ['4731', '4731'], ['7064', '7064'], ['6953', '6953'], ['2519', '2519'], ['5842', '5842']
  ], [], 'text'),
  ...letterSections('Mf Fg Yh Qj Ck Sl Nm Pw Wx Lc Rv Jb Tn'),
  section('readAloud', '词语阅读测试', '请大声读出屏幕上的词语。', [
    ['旅行', '旅行'], ['母亲', '母亲'], ['工作', '工作'], ['果汁', '果汁'], ['风景', '风景'], ['小狗', '小狗'], ['经典', '经典'], ['出发', '出发'],
    ['年龄', '年龄'], ['电脑', '电脑'], ['时间', '时间'], ['服务', '服务'], ['点心', '点心'], ['帮助', '帮助'], ['前面', '前面']
  ], [], 'text'),
  withFaces(section('faceName', '名人面孔识别测试（18–30岁）', '请说出图片上这位名人的名字。', [
    ['1', '迪丽热巴'], ['2', '郎朗'], ['3', '胡歌'], ['4', '姚明'], ['5', '周迅'],
    ['6', '王力宏'], ['7', '汪峰'], ['8', '宁静'], ['9', '唐嫣'], ['10', '刘翔']
  ], [], 'text', { ageBand: 'young', unseenMark: true }), 'assets/faces-b-18'),
  withFaces(section('faceName', '名人面孔识别测试（31–60岁）', '请说出图片上这位名人的名字。', [
    ['1', '舒淇'], ['2', '佟大为'], ['3', '汪峰'], ['4', '洪金宝'], ['5', '那英'],
    ['6', '赵丽颖'], ['7', '王力宏'], ['8', '刘烨'], ['9', '李雪健'], ['10', '梁家辉']
  ], [], 'text', { ageBand: 'older', unseenMark: true }), 'assets/faces-b-30'),
  withImages(section('spatial', '空间感知测试', '请判断箭头有没有指向图中的某个黑点。', [
    ['1', '否'], ['2', '否'], ['3', '否'], ['4', '否'], ['5', '否'], ['6', '是'], ['7', '是'], ['8', '是'],
    ['9', '否'], ['10', '否'], ['11', '是'], ['12', '是'], ['13', '否'], ['14', '否'], ['15', '否'], ['16', '是']
  ], ['是', '否']), 'assets/spatial-b'),
  withImages(section('clockImage', '时钟识别测试', '请回答钟面上的时针和分针都在左侧、都在右侧，还是一左一右。', [
    ['16:05', '右'], ['21:50', '左'], ['8:45', '左'], ['15:05', '右'], ['20:55', '左'], ['15:45', '两者'], ['19:25', '两者'], ['13:25', '右'],
    ['17:15', '右'], ['10:55', '左'], ['16:15', '右'], ['17:20', '右'], ['21:55', '左'], ['17:35', '两者'], ['20:20', '两者']
  ], clockOptions), 'assets/clock-b')
];

/* ---------------- 自评量表 ----------------
 * 条目以 * 开头表示反向计分（分值顺序自动翻转）。
 */

const buildScale = (name, intro, options, values, items) => items.map((item) => {
  const reverse = item.startsWith('*');
  const text = reverse ? item.slice(1) : item;
  return {
    section: name,
    sectionIntro: intro,
    scoring: 'scale',
    response: 'choice',
    options: [...options],
    values: reverse ? [...values].reverse() : [...values],
    reverse,
    text,
    display: text,
    audioText: text
  };
});

const vviqOptions = ['1 无画面', '2 模糊', '3 勉强清晰', '4 适度清晰', '5 非常清晰'];
const vviq = buildScale('VVIQ 视觉想象生动性测试',
  '请想象下面描述的画面，然后按 1–5 分评价这幅画面在您脑海中的清晰、生动程度。',
  vviqOptions, [1, 2, 3, 4, 5], [
    '请想象：人物脸部、头部、肩膀与身体的轮廓。', '请想象：人物头部、身体姿态等特有的姿势。',
    '请想象：人物走路时的步态、步幅等。', '请想象：人物经常穿着衣服的不同颜色组合。',
    '请想象：太阳正从地平线跃入朦胧的天空。', '请想象：天朗云清，太阳被蓝天所环绕。',
    '请想象：多云，天空中乌云密布，风暴夹杂着闪电袭来。', '请想象：天边出现了一道彩虹。',
    '请想象：在路对面看到的常去商店的全貌。', '请想象：橱窗中各类商品及其陈列位置、颜色等细节。',
    '请想象：走近商店，商店门的轮廓、颜色和特点。', '请想象：走进商店来到柜台，服务员为你服务、找钱等。',
    '请想象：有树木、山丘和湖的风景整体轮廓。', '请想象：风景中树木的颜色和外形。',
    '请想象：湖的颜色和外观。', '请想象：一阵风吹动树叶，湖面泛起涟漪。'
  ]);

/* PIT：原句“你过去……”“你将会……”很多人看不懂。改成口语，屏幕上先说清楚是回想还是想象，
 * 再问画面清不清楚。条目顺序、意思和计分（1–5）跟原版一一对应 */
const pitOptions = ['1 想不出画面', '2 很模糊', '3 模糊，但看得出是什么', '4 清楚', '5 非常清楚，像真的一样'];
const pitIntroPast = '每题是一件事。请闭上眼睛，回想你以前遇到这件事时的画面，然后选：画面有多清楚？没遇到过也可以想象一下。';
const pitIntroFuture = '每题是一件事。请闭上眼睛，想象以后这件事发生在你身上的画面，然后选：画面有多清楚？';
const pitItem = (lead) => (item) => `${lead}${item}`;

const pit = [
  ...buildScale('PIT 部分一：回想', pitIntroPast, pitOptions, [1, 2, 3, 4, 5], [
    '你和一个好朋友大吵了一架', '别人夸奖你', '你身体出了问题', '你做了一个让自己后悔的决定',
    '你觉得被别人误解', '你精力充沛、很有热情', '你在学习或工作上取得好成绩', '事情出了错，你被责怪',
    '你做成了自己想做的事', '你成了犯罪的受害者（被偷、被抢等）', '身边的人拒绝了你', '事情没有你希望的那么顺利',
    '别人不喜欢你', '你身体非常健康', '别人觉得你又闷又无聊', '你和朋友一起玩得很开心',
    '你轻松应对了压力', '你非常警觉、反应很快', '你交到了长久的好朋友', '你刚认识的人喜欢你'
  ].map(pitItem('回想以前：'))),
  ...buildScale('PIT 部分二：展望', pitIntroFuture, pitOptions, [1, 2, 3, 4, 5], [
    '你和一个好朋友大吵了一架', '别人夸奖你', '你身体出了问题', '你做了一个让自己后悔的决定',
    '你觉得被别人误解', '你精力充沛、很有热情', '你在学习或工作上取得好成绩', '事情出了错，你被责怪',
    '你做成了自己想做的事', '你成了犯罪的受害者（被偷、被抢等）', '身边的人拒绝了你', '事情没有你希望的那么顺利',
    '别人不喜欢你', '你身体非常健康', '别人觉得你又闷又无聊', '你和朋友一起玩得很开心',
    '你轻松应对了压力', '你非常警觉、反应很快', '你交到了长久的好朋友', '你刚认识的人喜欢你'
  ].map(pitItem('想象以后：')))
];

const baiOptions = ['无', '轻度：无多大困扰', '中度：不适但尚能忍受', '重度：只能勉强忍受'];
const bai = buildScale('BAI 贝克焦虑量表',
  '过去一周（包括今天），有没有下面这些情况？有的话，选出困扰你的程度。',
  baiOptions, [0, 1, 2, 3], [
    '麻木或刺痛', '感到发热', '腿部颤抖', '不能放松', '害怕发生不好的事情', '头晕', '心悸或心率加快',
    '心神不定', '容易受惊吓', '感到紧张', '有窒息感', '手发抖', '身体摇晃、站不稳', '害怕失控', '呼吸困难',
    '害怕快要死去', '感到恐慌', '消化不良或腹部不适', '快要晕倒', '脸发红', '出汗（不是因为天热）'
  ].map((item) => `过去一周，你有没有${item}？`));

const sdsOptions = ['A 从无或偶尔', 'B 有时', 'C 经常', 'D 总是如此'];
const sds = buildScale('SDS 抑郁自评量表',
  '请根据您最近一周的实际情况，选出最符合的选项。',
  sdsOptions, [1, 2, 3, 4], [
    '我感到情绪沮丧，郁闷', '*我感到早晨心情最好', '我要哭或想哭', '我夜间睡眠不好', '*我吃饭象平常一样多',
    '*我的性功能正常', '我感到体重减轻', '我为便秘烦恼', '我的心跳比平时快', '我无故感到疲乏',
    '*我的头脑象平常一样清楚', '*我做事情象平常一样不感到困难', '我坐卧难安，难以保持平静', '*我对未来感到有希望',
    '我比平时更容易激怒', '*我觉得决定什么事很容易', '*我感到自己是有用的和不可缺少的人', '*我的生活很有意思',
    '假若我死了，别人会过得更好', '*我仍旧喜欢自己平时喜欢的东西'
  ]);

/* ---------------- 儿童版量表（按需手动选择） ----------------
 * 原始回答（无 / 有时 / 经常）照常记录，另按 0 / 1 / 2 计分。
 * DSRS 第 1、2、4、7、8、9、11、12、13、16 题为正向描述，按常用计分规则反向计分；
 * 总分 ≥ 15 提示抑郁。SCARED 总分 ≥ 23 提示焦虑。
 */

const childOptions = ['无', '有时', '经常'];

const dsrs = buildScale('DSRS 儿童抑郁自评量表',
  '请根据你最近一周的实际感受，选出最符合的一项。',
  childOptions, [0, 1, 2], [
    '*我像平时一样盼望着许多美好的事物', '*我睡的很香', '我感到我总是想哭', '*我喜欢出去玩', '我想离家出走', '我肚子痛',
    '*我精力充沛', '*我吃东西很香', '*我对自己有信心', '我觉得生活没什么意思', '*我认为我所做的事都是令人满意的',
    '*我像平常那样喜欢各种事物', '*我喜欢与家里人一起交谈', '我做噩梦', '我感到非常孤单', '*遇到高兴的事我很容易高兴起来',
    '我感到十分悲哀，不能忍受', '我感到非常烦恼'
  ]);

const scared = buildScale('SCARED 儿童焦虑性情绪障碍筛查表',
  '下面的句子描述了人们的一些感受。请根据你最近三个月的情况，选出最符合的一项。',
  childOptions, [0, 1, 2], [
    '当我感到害怕时，出现呼吸困难（出气不赢）', '我在学校时感到头痛。', '我不喜欢与不太熟悉的人在一起。',
    '如果我不在家里睡觉，就觉得内心不安。', '我经常担心别人是不是喜欢我。', '当我害怕时，感到马上要死去似的。',
    '我总是感到紧张不安。', '父母无论去哪里我总是离不开他们。', '别人说我好像很紧张的样子',
    '当我与不熟悉的人在一起时就感到紧张', '在学校时就出现肚子痛。', '当我害怕时，自己感觉快要发疯，失去控制了。',
    '我总担心让我自己一个人睡觉。', '我担心自己不像其他孩子一样好。', '当我害怕时，感到恍恍惚惚，好像周围的一切不真实似的。',
    '我梦见父母发生了不幸的事情。', '我担心又要去上学。', '我害怕时，心跳会加快。', '我手脚发抖打颤。',
    '我梦见发生了对我不利的事情。', '我对于一些精心为我而安排的事感到不安和不自在。', '当我害怕时，我会出汗。',
    '我是一个忧虑的人。', '我无缘无故地感到害怕。', '我害怕一个人待在家里。', '我觉得和不熟悉的人说话很困难。',
    '我害怕时感到不能呼吸。', '别人总说我担心得太多了。', '我不愿离开自己的家。',
    '我担心以前那种紧张（或惊恐）的感觉再次出现。', '我总担心父母会出事。', '当我与不熟悉的人在一起时，觉得害羞。',
    '我担心将来会发生什么事情。', '我害怕时感到恶心、想吐。', '我担心自己能不能把事情做好。', '我害怕去上学。',
    '我担忧已发生了什么事。', '我害怕时，感到头昏。',
    '当我与其他伙伴或大人在一起做事情时（如在朗读、说话、游戏、做体育活动时），如果他们看着我，我就感到紧张。',
    '当我去参加活动、跳舞或者有不熟悉的人在场时，就感到紧张。', '我是一个害羞的人。'
  ]);

/* 认知任务：每份只有一道“任务题”，作答时进入全屏任务（tasks.js），结果整份记为一个答案 */
const taskQuestion = (task, title, intro) => ({
  section: title,
  sectionIntro: intro,
  text: title,
  display: title,
  response: 'task',
  task,
  scoring: 'task',
  options: []
});

//@A{
/* ---------------- 自适应用的难题 ----------------
 * 按分区名列出“难题”的题号（从 1 开始，按本分区原始顺序）。
 * 开启自适应后，每个部分先做这些难题；全部答对，本部分其余题直接记为正确。
 * 这一版是按经验挑的（比较对象接近、答案反直觉、刺激更复杂），积累数据后应按实际错误率调整。
 * 在问卷编辑里也可以逐题勾选“难题”。
 */
const shared = {
  物理细节心理表征测试: [2, 6, 7, 9, 10, 12, 14, 15],
  '色彩对比测试（第二部分）': [4, 6, 7, 9, 10],
  '名人面孔心理表征测试（18–30岁）': [3, 5, 7, 9, 10],
  '名人面孔心理表征测试（30–60岁）': [3, 5, 7, 9, 10],
  城市地理方位判断测试: [4, 5, 7, 8, 11, 13, 15]
};
const hardImageryA = {
  ...shared,
  动物比较测试: [1, 2, 5, 8, 10],
  物体对比测试: [1, 2, 5, 6, 10],
  形态辨别测试: [1, 3, 4, 7, 10],
  物体心理表征测试: [1, 4, 5, 8, 10],
  物体典型颜色回忆测试: [4, 5, 7, 8, 9],
  '色彩对比测试（第一部分）': [2, 4, 7, 8, 9],
  个位数心理表征测试: [3, 6, 7, 8, 9],
  多位数心理表征测试: [3, 5, 6, 8, 9],
  字母心理构建测试: [3, 5, 6, 7, 9, 10, 12],
  汉字心理表征测试: [1, 3, 4, 6, 8, 9, 12],
  词语心理表征测试: [4, 6, 8, 9, 11, 12, 13],
  空间表征测试: [1, 2, 3, 5, 6, 8, 9, 10],
  时钟测试: [2, 4, 8, 9, 12, 14, 15]
};
const hardImageryB = {
  ...shared,
  动物比较测试: [1, 2, 6, 7, 10],
  物体对比测试: [1, 3, 5, 6, 8],
  形态辨别测试: [1, 2, 3, 5, 9],
  物体心理表征测试: [3, 4, 5, 8, 10],
  物体典型颜色回忆测试: [1, 3, 4, 8, 9],
  '色彩对比测试（第一部分）': [4, 5, 6, 8, 10],
  个位数心理表征测试: [2, 6, 7, 9, 10],
  多位数心理表征测试: [2, 3, 4, 7, 8],
  字母心理构建测试: [3, 6, 7, 10, 11, 12, 13],
  汉字心理表征测试: [3, 4, 5, 6, 8, 10, 12],
  词语心理表征测试: [1, 4, 5, 8, 11, 12, 13],
  空间表征测试: [1, 3, 4, 7, 8, 10, 13, 15],
  时钟测试: [1, 4, 6, 7, 10, 12, 14]
};
const hardPerceptionA = {
  物理细节判断测试: [2, 6, 7, 9, 10, 12, 14, 15],
  颜色名称测试: [3, 5, 8, 9, 11, 12, 13],
  个位数阅读测试: [2, 4, 6, 8, 10],
  多位数阅读测试: [1, 3, 4, 8, 10],
  大写字母阅读测试: [2, 4, 5, 9, 10, 11, 13],
  小写字母阅读测试: [2, 4, 5, 9, 10, 11, 13],
  词语阅读测试: [1, 5, 9, 10, 11, 14, 15],
  '名人面孔识别测试（18–30岁）': [5, 7, 8, 9, 10],
  '名人面孔识别测试（31–60岁）': [1, 7, 8, 9, 10],
  空间感知测试: [1, 2, 3, 5, 6, 8, 9, 10],
  时钟识别测试: [1, 3, 4, 9, 10, 14, 15]
};
const hardPerceptionB = {
  ...hardPerceptionA,
  多位数阅读测试: [2, 4, 5, 7, 9],
  大写字母阅读测试: [2, 4, 8, 9, 10, 11, 12],
  小写字母阅读测试: [2, 4, 8, 9, 10, 11, 12],
  词语阅读测试: [1, 5, 7, 9, 12, 13, 14],
  '名人面孔识别测试（18–30岁）': [5, 6, 7, 8, 9],
  '名人面孔识别测试（31–60岁）': [2, 4, 8, 9, 10],
  空间感知测试: [1, 3, 4, 7, 8, 10, 13, 15],
  时钟识别测试: [3, 5, 6, 7, 10, 14, 15]
};
const withHard = (defs, map) => defs.map((def) => (map[def.name] ? { ...def, hard: map[def.name] } : def));
//@A}

window.scalePadPresets = [
  { name: 'BIP A 套｜先感知、再想象', group: 'bipSet', parts: ['BIP A｜视觉感知', 'BIP A｜视觉心理意象'],
    questions: combinedSet(withHard(perceptionA, hardPerceptionA), withHard(imageryA, hardImageryA)).flatMap(buildSection) }, /*@A*/
    //@E questions: combinedSet(perceptionA, imageryA).flatMap(buildSection) },
  { name: 'BIP B 套｜先感知、再想象', group: 'bipSet', parts: ['BIP B｜视觉感知', 'BIP B｜视觉心理意象'],
    questions: combinedSet(withHard(perceptionB, hardPerceptionB), withHard(imageryB, hardImageryB)).flatMap(buildSection) }, /*@A*/
    //@E questions: combinedSet(perceptionB, imageryB).flatMap(buildSection) },
  { name: 'BIP A｜视觉感知', group: 'bipPart', questions: withHard(doctorFirst(perceptionA), hardPerceptionA).flatMap(buildSection) }, /*@A*/
  //@E { name: 'BIP A｜视觉感知', group: 'bipPart', questions: doctorFirst(perceptionA).flatMap(buildSection) },
  { name: 'BIP A｜视觉心理意象', group: 'bipPart', questions: withHard(doctorFirst(imageryA), hardImageryA).flatMap(buildSection) }, /*@A*/
  //@E { name: 'BIP A｜视觉心理意象', group: 'bipPart', questions: doctorFirst(imageryA).flatMap(buildSection) },
  { name: 'BIP B｜视觉感知', group: 'bipPart', questions: withHard(doctorFirst(perceptionB), hardPerceptionB).flatMap(buildSection) }, /*@A*/
  //@E { name: 'BIP B｜视觉感知', group: 'bipPart', questions: doctorFirst(perceptionB).flatMap(buildSection) },
  { name: 'BIP B｜视觉心理意象', group: 'bipPart', questions: withHard(doctorFirst(imageryB), hardImageryB).flatMap(buildSection) }, /*@A*/
  //@E { name: 'BIP B｜视觉心理意象', group: 'bipPart', questions: doctorFirst(imageryB).flatMap(buildSection) },
  { name: 'VVIQ｜视觉想象生动性', questions: vviq },
  { name: 'PIT｜前瞻意象任务', questions: pit },
  { name: 'BAI｜贝克焦虑量表', questions: bai },
  { name: 'SDS｜抑郁自评量表', questions: sds },
  { name: '数轴评估', group: 'task', questions: [taskQuestion('numberline', '数轴评估', '22 题：在 1–100 的数轴上标出数字的位置。触屏时手指可按在数轴下方，左右拖动红点，抬起手指确认。')] },
  { name: '点数比较评估', group: 'task', questions: [taskQuestion('dots', '点数比较评估', '20 题：判断左右哪边点多，每题限时 10 秒。点屏幕左半边选左，右半边选右（接键盘时也可用 ← →）。')] },
  { name: 'DSRS｜儿童抑郁自评', group: 'child', questions: dsrs },
  { name: 'SCARED｜儿童焦虑筛查', group: 'child', questions: scared }
];

window.scalePadExamples = examples;
