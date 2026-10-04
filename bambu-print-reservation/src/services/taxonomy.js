// ============================================================
// 需求标签池（taxonomy）——「勾选 → 规则引擎 → 切片」体系的第一层词汇表
//
// 设计铁律（与曼波 2026-10-05 定稿口径一致）：
//   1. 每个标签必须能回答「映射到什么切片参数」——mapsHint 为空视为设计缺陷；
//   2. 正交分解：方向 × 类型 × 性质等维度独立，组内单选/组间多选；
//   3. 默认不勾 = 常规件一键提交，勾得越多引擎约束越多；
//   4. 词汇表（本文件）与映射规则库（待建 processRules）分离，版本号独立；
//      本文件只有 taxonomyVersion，规则库另有 rulesVersion。
//
// 受力参照系约定（力学标签的基石）：
//   所有方向标签以「模型上传时的摆放姿态」为参照，Z = 竖直向上
//   （CAD 导出的设计姿态通常是使用姿态）。Z 向受力 ≈ 层间受力（最弱方向）。
// ============================================================

const TAXONOMY_VERSION = 'v2';

/** 选项：{ id, label }；bool/number 字段无 options */
const groups = [
  {
    id: 'load',
    title: '载荷工况',
    tooltip: '零件怎么受力——决定打印朝向与强度布局，是最优先的一组',
    fields: [
      {
        id: 'load_direction',
        type: 'single',
        title: '受力方向',
        formTitle: '受力方向',
        tooltip: '以模型上传时姿态为参照（Z=竖直向上）。Z 向受力=沿层缝受力，引擎会优先改打印朝向避开；改不了则强化层间',
        options: [
          { id: 'X', label: 'X 轴（水平横向）' },
          { id: 'Y', label: 'Y 轴（水平纵向）' },
          { id: 'Z', label: 'Z 轴（竖直向上）' },
          { id: 'multi', label: '多向/复杂受力' },
        ],
        mapsHint: [
          'Z → 优先改朝向避开层间受力；不可避 → 层高 0.12–0.16、墙数+、热床 +5~10°C 强化层间',
          'multi → 不强行改朝向，按强度档位补墙/填充',
        ],
      },
      {
        id: 'load_type',
        type: 'multi',
        title: '受力类型',
        formTitle: '受力类型',
        tooltip: '可多选（悬臂梁=弯曲+剪切）。滚压/点接触指滚轮、凸轮从动件等局部接触工况',
        options: [
          { id: 'tension', label: '受拉' },
          { id: 'compression', label: '受压' },
          { id: 'shear', label: '剪切' },
          { id: 'bending', label: '弯曲' },
          { id: 'torsion', label: '扭转' },
          { id: 'contact', label: '滚压/点接触' },
        ],
        mapsHint: [
          'bending/shear → 墙数≥3（受力件4）、填充≥40%（Gyroid/Cubic）、提示 CF 增强材料',
          'torsion → 45° 交叉填充方向、孔轴处加密',
          'contact → PA 系优先、提示嵌滚轮轴承、接触区局部高填充',
        ],
      },
      {
        id: 'load_nature',
        type: 'single',
        title: '载荷性质',
        formTitle: '载荷性质',
        tooltip: '静载=挂住不动；动载疲劳=反复受力（弹簧、锁扣、行驶颠簸）；冲击=磕碰撞击；振动=底盘/发射机构等持续震源',
        options: [
          { id: 'static', label: '静载' },
          { id: 'fatigue', label: '动载疲劳' },
          { id: 'impact', label: '冲击' },
          { id: 'vibration', label: '振动' },
        ],
        mapsHint: [
          'fatigue → 排除直线高填充（应力集中），Gyroid；圆角处理提醒',
          'impact → 材料转 PETG 等韧性系（排除全 CF 脆性）、墙数+',
          'vibration → Gyroid 填充、避薄壁共振、螺接防松提醒',
        ],
      },
      {
        id: 'load_magnitude',
        type: 'single',
        title: '载荷量级',
        formTitle: '载荷量级',
        tooltip: '等效静重估计：轻=小支架/装饰件（<1kg）；中=一般结构件/云台（1–5kg）；重=底盘承重/举升机构（>5kg）',
        options: [
          { id: 'light', label: '轻载' },
          { id: 'medium', label: '中载' },
          { id: 'heavy', label: '重载' },
        ],
        mapsHint: [
          'light → 填充 20%、墙数 2',
          'medium → 填充 40%、墙数 3',
          'heavy → 填充 60%+、墙数 4、材料上 CF/PA 档',
        ],
      },
    ],
  },
  {
    id: 'durability',
    title: '耐久工况',
    tooltip: '要求这零件活多久、在什么老化机制下活——寿命 × 载荷性质组合出蠕变/疲劳风险',
    fields: [
      {
        id: 'service_life',
        type: 'single',
        title: '使用寿命',
        formTitle: '使用寿命',
        tooltip: '一次性=打完即弃的验证件；短期=赛季内（数周）；长期=跨学期持续使用。长期+静载→蠕变风险，长期+动载→疲劳风险',
        options: [
          { id: 'oneoff', label: '一次性（验证件）' },
          { id: 'short_term', label: '短期（赛季内）' },
          { id: 'long_term', label: '长期（跨学期）' },
        ],
        mapsHint: [
          'long_term × 静载 → 排除 PLA（蠕变重灾区），PETG/PA/CF 系',
          'long_term × 动载 → 疲劳规则叠加寿命规则',
          'oneoff → 允许降质量快速件（与高速打印协同）',
        ],
      },
      {
        id: 'stiffness',
        type: 'single',
        title: '刚度需求',
        formTitle: '刚度需求',
        tooltip: '刚性=不能晃（支撑臂）；柔性弹性=需要反复弹性变形（活铰链、卡扣、弹簧片）——柔性件禁 CF（脆）',
        options: [
          { id: 'rigid', label: '刚性（不许晃）' },
          { id: 'flexible', label: '柔性弹性（活铰/卡扣）' },
        ],
        mapsHint: [
          'rigid → CF/高填充方向',
          'flexible → PETG/PA 等韧性系、低填充方向设计、壁薄化提醒、排除 CF',
        ],
      },
      {
        id: 'impact_resistance',
        type: 'bool',
        title: '抗冲击',
        formTitle: '抗冲击',
        tooltip: '要求承受磕碰/跌落不断裂（耐久口径，与载荷性质里的「冲击」勾一处即可，引擎取并集）',
        mapsHint: ['材料 PETG/韧性系优先、墙数+；PLA-CF 类脆性组合需确认'],
      },
      {
        id: 'wear_resistance',
        type: 'bool',
        title: '耐磨',
        formTitle: '耐磨',
        tooltip: '滑动摩擦件：滑块、齿轮、凸轮面。长期干摩擦',
        mapsHint: ['PA 系优先；提示嵌金属衬套/轴承的复合设计'],
      },
      {
        id: 'electrical_insulation',
        type: 'bool',
        title: '电气绝缘',
        formTitle: '电气绝缘',
        tooltip: '用于电气隔离（绝缘垫、接线端子座）。⚠️ 碳纤增强材料导电，此项将强制排除一切 CF 系',
        mapsHint: ['排除一切 CF 系（碳纤维导电，安全级拦截）；普通 PLA/PETG/ABS 均绝缘'],
      },
    ],
  },
  {
    id: 'fit',
    title: '精度与连接',
    tooltip: '有没有配合面、怎么装到机器人上——决定孔径补偿与局部加固',
    fields: [
      {
        id: 'fit_class',
        type: 'single',
        title: '配合需求',
        formTitle: '配合需求',
        tooltip: '间隙=能装能转（轴孔）；过渡=紧配；过盈=压装；精密=有公差要求的配合面。螺纹孔请配合下方「连接方式」标注',
        options: [
          { id: 'clearance', label: '间隙配合' },
          { id: 'transition', label: '过渡配合' },
          { id: 'interference', label: '过盈配合' },
          { id: 'precision', label: '精密公差' },
        ],
        mapsHint: [
          '孔径负向补偿 + 外轮廓补偿、外壁降速；interference × ABS 收缩大 → 警告换料或加收缩补偿',
        ],
      },
      {
        id: 'fastener',
        type: 'multi',
        title: '连接方式',
        formTitle: '连接方式',
        tooltip: '可多选。自攻螺钉=直接拧入塑料；机制螺栓=M2/M3/M4 螺栓过孔；热熔铜螺母=烙铁压入预埋件；胶接=粘接面',
        options: [
          { id: 'self_tapping', label: '自攻螺钉' },
          { id: 'machine_screw', label: '机制螺栓' },
          { id: 'heatset_insert', label: '热熔铜螺母' },
          { id: 'adhesive', label: '胶接' },
        ],
        mapsHint: [
          'self_tapping → 底孔直径按规格表（M2/M3/M4）、孔周 ≥2 圈墙',
          'machine_screw → 通孔负补偿（公差）',
          'heatset_insert → 孔径按嵌件规格、孔周加固；胶接 → 接触面粗糙化提示（0.2 层高即可）',
        ],
      },
    ],
  },
  {
    id: 'surface',
    title: '外观',
    tooltip: '有没有面子要求——支撑策略、层高、接缝的头号决策项',
    fields: [
      {
        id: 'appearance',
        type: 'bool',
        title: '外观件',
        formTitle: '外观件',
        tooltip: '有外观面要求。请在备注注明外观面朝向（如「顶面+前表面」），支撑将避让该面',
        mapsHint: [
          '层高 0.12、顶面 5 层/底面 4 层、接缝 hidden、外壁慢速、熨烫、支撑阈值 45° 避支撑痕、喷嘴 +5°C',
          '与高速打印冲突 → 警告确认（表面质量 vs 工期二选一）',
        ],
      },
    ],
  },
  {
    id: 'thermal',
    title: '热学工况',
    tooltip: '工作环境温度——材料选型的硬门槛（PLA 60°C 软化是第一红线）',
    fields: [
      {
        id: 'temp_class',
        type: 'single',
        title: '耐温等级',
        formTitle: '耐温等级',
        tooltip: '零件工作环境最高温度。常温≤50°C；中温 50–80°C（引擎舱旁、夏天车内）；高温 80–120°C（电机座）；超高温 >120°C 转人工评审',
        options: [
          { id: 't50', label: '常温（≤50°C）' },
          { id: 't80', label: '中温（50–80°C）' },
          { id: 't120', label: '高温（80–120°C）' },
          { id: 't120p', label: '超高温（>120°C）' },
        ],
        mapsHint: [
          't80+ → 排除 PLA（60°C 玻璃化软化），PETG 起步',
          't120 → 排除 PETG（80°C），ABS/PA 系',
          't120p → 超出常规耗材能力，转人工评审（可能需改机加工）',
        ],
      },
      {
        id: 'thermal_insulation',
        type: 'bool',
        title: '隔热',
        formTitle: '隔热',
        tooltip: '用结构件做隔热屏障。塑料本身导热都低，隔热主要靠结构：密闭气隙分层优于实心',
        mapsHint: ['Gyroid/低密度填充做密闭气隙；避免实心（导热路径短、费料）'],
      },
    ],
  },
  {
    id: 'environment',
    title: '环境工况',
    tooltip: '使用环境对材料的老化影响',
    fields: [
      {
        id: 'oil_resistant',
        type: 'bool',
        title: '耐油/冷却液',
        formTitle: '耐油冷却液',
        tooltip: '会接触润滑油、冷却液、溶剂等',
        mapsHint: ['PP/PA > PETG > ABS；PLA 怕部分溶剂 → 提示换料'],
      },
      {
        id: 'uv_resistant',
        type: 'bool',
        title: '户外/UV',
        formTitle: '户外UV',
        tooltip: '长期日照/户外使用。PLA 怕 UV 与湿热，会脆化',
        mapsHint: ['排除 PLA → ASA/PETG 方向'],
      },
      {
        id: 'humidity_resistant',
        type: 'bool',
        title: '湿热环境',
        formTitle: '湿热环境',
        tooltip: '长期潮湿/水汽环境。注意 PA（尼龙）吸水会膨胀变形',
        mapsHint: ['排除 PA（吸湿变形）或提醒干燥打印与密封处理'],
      },
    ],
  },
  {
    id: 'efficiency',
    title: '效率与批量',
    tooltip: '工期与数量——高速牺牲表面质量换时间',
    fields: [
      {
        id: 'fast_mode',
        type: 'bool',
        title: '高速打印',
        formTitle: '高速打印',
        tooltip: '用高速度/粗层高换工期（表面质量略降）。会联动加急排队优先级；与外观件互斥，引擎会警告',
        mapsHint: ['高速 profile（层高 0.2+、提速）；联动 isUrgent 排队加权'],
      },
      {
        id: 'quantity',
        type: 'number',
        title: '份数',
        formTitle: '份数',
        tooltip: '需要打印的件数（1–99）。批量将排版多件或分机并行，ETA 按份数放大',
        mapsHint: ['N 件排版/分机并行；ETA = N × 单件时长（切片产物自带时长）'],
      },
    ],
  },
  {
    id: 'weight',
    title: '重量',
    tooltip: '飞行器/云台末端等重量敏感件',
    fields: [
      {
        id: 'weight_sensitive',
        type: 'bool',
        title: '重量敏感',
        formTitle: '重量敏感',
        tooltip: '对重量有要求（无人机、云台末端、臂末端）。将用低填充+镂空方向设计，强度档位让位于减重',
        mapsHint: ['Gyroid 低填充、顶底壳减至 3 层（壳厚是减重大头）、必要时镂空（人工确认）'],
      },
    ],
  },
];

// ============================================================
// 冲突规则：when（字段值断言，组内 OR、字段间 AND）+ materialMatch（材料正则，可选）
// level=block 表单端拦截；level=warn 警告确认放行
// ============================================================
const CONFLICTS = [
  {
    id: 'temp-vs-pla',
    level: 'block',
    when: { temp_class: ['t80', 't120', 't120p'] },
    materialMatch: /^PLA/i,
    message: '耐温 ≥80°C 与 PLA 系冲突（PLA 60°C 即软化），请换 PETG/ABS/PA 或下调耐温等级',
  },
  {
    id: 'insulation-vs-cf',
    level: 'block',
    when: { electrical_insulation: [true] },
    materialMatch: /CF|碳/i,
    message: '电气绝缘件禁用碳纤增强材料（碳纤维导电），请换普通 PLA/PETG/ABS',
  },
  {
    id: 'creep-vs-pla',
    level: 'block',
    when: { service_life: ['long_term'], load_nature: ['static'] },
    materialMatch: /^PLA/i,
    message: '长期静载工况下 PLA 蠕变严重（数周即明显松垂），请换 PETG/PA/CF 系或缩短使用寿命',
  },
  {
    id: 'flexible-vs-cf',
    level: 'warn',
    when: { stiffness: ['flexible'] },
    materialMatch: /CF|碳/i,
    message: '柔性弹性工况与 CF 增强材料冲突（CF 脆、无法弹性变形），建议确认是否换韧性材料',
  },
  {
    id: 'fast-vs-appearance',
    level: 'warn',
    when: { fast_mode: [true], appearance: [true] },
    message: '高速打印会牺牲表面质量，与「外观件」要求冲突，请确认优先级',
  },
  {
    id: 'interference-vs-abs',
    level: 'warn',
    when: { fit_class: ['interference'] },
    materialMatch: /^ABS/i,
    message: 'ABS 收缩明显，过盈配合公差不易控制，建议改 PETG 或由规则库加收缩补偿',
  },
  {
    id: 'weight-vs-heavy',
    level: 'warn',
    when: { weight_sensitive: [true], load_magnitude: ['heavy'] },
    message: '重量敏感与重载工况存在张力（减重设计 vs 强度档位），引擎将冲突转人工评审',
  },
];

// ============================================================
// 校验与表单提取
// ============================================================

const fieldsById = new Map();
for (const g of groups) {
  for (const f of g.fields) {
    if (fieldsById.has(f.id)) throw new Error(`[taxonomy] 字段 id 重复: ${f.id}`);
    fieldsById.set(f.id, f);
  }
}

/** 校验一份勾选结果（selection: fieldId → value）。
 * @param {Object} selection
 * @param {Object} [opts] opts.material 材料字符串（如 "PLA-CF"），提供时才做材料类冲突判定
 * @returns {{errors: string[], warnings: string[]}} errors 非空即拦截
 */
function validateSelection(selection, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!selection || typeof selection !== 'object') {
    return { errors: ['勾选内容为空或格式不正确'], warnings };
  }

  for (const [fieldId, value] of Object.entries(selection)) {
    const field = fieldsById.get(fieldId);
    if (!field) {
      errors.push(`未知需求标签: ${fieldId}`);
      continue;
    }
    if (value === undefined || value === null || value === false || value === '') continue;
    if (field.type === 'single') {
      if (!field.options.some((o) => o.id === value)) {
        errors.push(`「${field.title}」选项无效: ${value}`);
      }
    } else if (field.type === 'multi') {
      if (!Array.isArray(value)) {
        errors.push(`「${field.title}」应为多选数组`);
        continue;
      }
      for (const v of value) {
        if (!field.options.some((o) => o.id === v)) {
          errors.push(`「${field.title}」选项无效: ${v}`);
        }
      }
    } else if (field.type === 'number') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 99) {
        errors.push(`「${field.title}」应为 1–99 的整数`);
      }
    } // bool: truthy 即合法
  }

  for (const rule of CONFLICTS) {
    const hit = Object.entries(rule.when).every(([fieldId, values]) => {
      const v = selection[fieldId];
      if (Array.isArray(v)) return v.some((x) => values.includes(x)); // multi 字段任一命中
      return values.includes(v);
    });
    if (!hit) continue;
    if (rule.materialMatch) {
      if (!opts.material || !rule.materialMatch.test(String(opts.material))) continue;
    }
    (rule.level === 'block' ? errors : warnings).push(rule.message);
  }

  return { errors, warnings };
}

/**
 * 从审批表单字段（parseForm 同款 [{title, value}] 形态）提取标准化勾选。
 * 只消费本池登记的 formTitle，其余字段原样忽略（材料/颜色/附件由既有解析负责）。
 * @returns {{selection: Object, unmatched: string[]}} unmatched=字段匹配上但值无法识别的提示
 */
function selectionFromFormFields(fields) {
  const selection = {};
  const unmatched = [];
  for (const item of fields || []) {
    const title = String(item.title || '').trim();
    const field = [...fieldsById.values()].find((f) => f.formTitle === title);
    if (!field) continue;
    const raw = item.value;
    if (field.type === 'bool') {
      if (/是|需要|有|true|1|y/i.test(String(raw))) selection[field.id] = true;
      else if (/否|不|无|false|0|n/i.test(String(raw))) { /* 显式为否：不写入 */ }
      else unmatched.push(`${title}: 无法识别的布尔值「${raw}」`);
    } else if (field.type === 'single') {
      const label = String(raw || '').trim();
      const opt = field.options.find((o) => o.label === label);
      if (opt) selection[field.id] = opt.id;
      else unmatched.push(`${title}: 选项「${label}」不在标签池内`);
    } else if (field.type === 'multi') {
      const labels = Array.isArray(raw) ? raw : String(raw || '').split(/[,，、\s]+/);
      const ids = [];
      for (const label of labels) {
        const opt = field.options.find((o) => o.label === label.trim());
        if (opt) ids.push(opt.id);
        else if (label.trim()) unmatched.push(`${title}: 选项「${label.trim()}」不在标签池内`);
      }
      if (ids.length > 0) selection[field.id] = ids;
    } else if (field.type === 'number') {
      const n = parseInt(String(raw), 10);
      if (Number.isInteger(n)) selection[field.id] = n;
      else unmatched.push(`${title}: 无法识别的数量「${raw}」`);
    }
  }
  return { selection, unmatched };
}

/** 窗口输出（GET /api/print/taxonomy）：标签池全景 + 冲突规则可读版 */
function getTaxonomy() {
  return {
    version: TAXONOMY_VERSION,
    convention: '受力方向以模型上传时摆放姿态为参照，Z = 竖直向上',
    groups: groups.map((g) => ({
      id: g.id,
      title: g.title,
      tooltip: g.tooltip,
      fields: g.fields.map((f) => ({
        id: f.id,
        type: f.type,
        title: f.title,
        formTitle: f.formTitle,
        tooltip: f.tooltip,
        mapsHint: f.mapsHint,
        options: f.options,
      })),
    })),
    conflicts: CONFLICTS.map((c) => ({
      id: c.id,
      level: c.level,
      when: c.when,
      materialMatch: c.materialMatch ? c.materialMatch.source : null,
      message: c.message,
    })),
  };
}

module.exports = {
  TAXONOMY_VERSION,
  groups,
  CONFLICTS,
  validateSelection,
  selectionFromFormFields,
  getTaxonomy,
};
