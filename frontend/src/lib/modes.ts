// 翻译模式（领域约束模板）· Track C 2026-10-06
// ------------------------------------------------------------
// 模式 = 一组预填的 Constraints（Hard / Soft / Genre / JSONPreserve），
// 与约束抽屉共用同一数据形态；术语本（Glossary）独立于模式，不随切换重置。
//
// 内置六个模板：standard 完全对齐官方 translate.py 的无约束默认
//（无硬/软约束、genre=文本），通用增强与四个领域模板共用语义底线。
// 自定义模式（预留接口）：用户在设置页「翻译模式」卡片增删改，落 localStorage；
// 组件层也可以把手动调过的约束存进 lastCustom（模式自动切到"自定义"）。
// 后端无需改动：Constraints 五字段链路已在 Track C 接通（app.go TranslateRequestUI）。
import { create } from 'zustand'

export interface ModeConstraints {
  hard: string[]
  soft: string[]
  genre: string
  jsonPreserve: boolean
}

export interface ModePreset {
  id: string
  name: string
  description: string
  /** 内置模板只读，不可编辑/删除 */
  builtin?: boolean
  constraints: ModeConstraints
}

/** 手动自定义档在模式列表里的固定 id */
export const MANUAL_CUSTOM_ID = 'custom'

// 优先级写入预设自身，沿现有 Hard/Soft 链路发送；官方默认和用户自定义不自动注入。
const SEMANTIC_HARD = [
  '完整传达原文信息，不遗漏人物关系、动作、地点及限定条件，不添加原文未表达的事实或解释',
  '准确保留否定、比较、因果、条件和时间范围，不扩大或缩小其适用范围',
  '保留原文的可能性、确定程度和评价强度，不将推测译为事实，不自行强化或弱化语气',
  '根据上下文确定多义词和习语的含义，允许调整语序和拆分长句，但不得改变原意',
  '先满足准确性、完整性及明确的术语要求，再满足文体和排版偏好；不得为满足风格要求改变原意',
]

const NAMING_HARD =
  '专名和术语优先使用术语表指定译名，否则采用有把握的目标语言通行译名；无法确定时保留原文，或音译并括注原文，不臆造所谓官方译名；同一指称保持译法一致，仅在消除歧义或识别专名确有需要时括注原文'

export const BUILTIN_MODES: ModePreset[] = [
  {
    id: 'standard',
    name: '通用翻译',
    description: '官方默认：不加任何硬/软约束，文体"文本"，最通用',
    builtin: true,
    constraints: { hard: [], soft: [], genre: '文本', jsonPreserve: false },
  },
  {
    id: 'general-enhanced',
    name: '通用增强',
    description: '语义准确优先：保留信息、逻辑限定与推测语气，表达自然，适合与官方默认对照',
    builtin: true,
    constraints: {
      genre: '文本',
      hard: [...SEMANTIC_HARD, NAMING_HARD],
      soft: [
        '使用自然、清晰的目标语言表达，避免机械照搬源语言句式',
        '保留原文文体和语气，不为追求流畅而省略信息或增强措辞',
      ],
      jsonPreserve: false,
    },
  },
  {
    id: 'politics-finance',
    name: '政治经济·社科金融',
    description: '时政与社科财经：数字准确、译名统一，保留原文立场、归因与文体',
    builtin: true,
    constraints: {
      genre: '时政与财经',
      hard: [
        ...SEMANTIC_HARD,
        NAMING_HARD,
        '货币金额、汇率、指数点位、百分比等数字必须与原文完全一致，不得四舍五入或换算',
        '职务头衔按目标语言官方惯例翻译，不得臆造',
        '准确保留原文立场、观点归属及评价强度，译者不另加立场，不作阐释或软化',
        '缩略语在原文提供全称时准确翻译；未提供时不猜测扩写',
      ],
      soft: [
        '保留原文属于新闻、论述、评论或报告的文体特征，使用自然、清晰的目标语言',
      ],
      jsonPreserve: false,
    },
  },
  {
    id: 'tech-ai',
    name: '计算机·人工智能',
    description: '技术文本：代码与标识符保留、概念按语境翻译，中文混排按需留空格',
    builtin: true,
    constraints: {
      genre: '科技',
      hard: [
        ...SEMANTIC_HARD,
        NAMING_HARD,
        'API 名、库名、命令、代码标识符、文件路径、配置键名、报错信息原样保留，不得翻译',
        '产品、模型、框架、数据集的专有名称（如 PyTorch）保留原文；普通技术概念按上下文和术语表翻译，不因使用英文就一律保留',
        '版本号、超参数名、计量单位保持原样，不得改写',
      ],
      soft: [
        '仅在译为中文时，中文与拉丁字母、数字之间按排版习惯留空格；不修改代码、路径和链接内部的空格或字符',
        '行文简洁精确，保留原文的教程、说明或论述文体',
      ],
      jsonPreserve: false,
    },
  },
  {
    id: 'humanities',
    name: '人文写作',
    description: '文学与人文：准确完整、表达自然，保留修辞作用与语气，不过度润色',
    builtin: true,
    constraints: {
      genre: '文学与人文',
      hard: [
        ...SEMANTIC_HARD,
        NAMING_HARD,
        '书名、作品名采用有把握的目标语言惯用译名，无法确定时保留原文，不自拟并冒充惯用译名',
        '保留修辞的含义、意象和表达作用；可按目标语言习惯调整形式，不自行添加修辞或强化评价',
      ],
      soft: [
        '在准确完整的前提下使用自然流畅的目标语言；文学性与原文相称，不刻意美化或渲染',
        '保留原文的语气、语域与时代感，避免翻译腔',
      ],
      jsonPreserve: false,
    },
  },
  {
    id: 'medical-bio',
    name: '医疗生物',
    description: '医学与生命科学：保留药名身份、剂量单位及证据强度，基因符号不改写',
    builtin: true,
    constraints: {
      genre: '医学与生命科学',
      hard: [
        ...SEMANTIC_HARD,
        NAMING_HARD,
        '保留原文对药品通用名与商品名的区分，不擅自将商品名替换为通用名或反向替换，不补充原文未提供的药品身份',
        '疾病、解剖学、药理学术语按目标语言医学规范译法；基因/蛋白符号保留原文',
        '剂量、单位、浓度、临床试验编号（如 NCT 编号）必须与原文完全一致',
        '准确保留原文的不确定性、适用条件及证据强度，不自行明确化或绝对化',
      ],
      soft: [
        '表述严谨、清晰，保留原文的文献、说明或科普文体',
      ],
      jsonPreserve: false,
    },
  },
]

const CUSTOM_KEY = 'indexvt.customModes'
const LAST_CUSTOM_KEY = 'indexvt.lastCustomConstraints'

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存不下只用内存态 */
  }
}

const EMPTY_CONSTRAINTS: ModeConstraints = { hard: [], soft: [], genre: '', jsonPreserve: false }

interface ModeState {
  customModes: ModePreset[]
  /** 手动调过约束后的最近一份（"自定义"档的持久值） */
  lastCustom: ModeConstraints
  upsert: (m: ModePreset) => void
  remove: (id: string) => void
  setLastCustom: (c: ModeConstraints) => void
}

export const useModeStore = create<ModeState>((set, get) => ({
  customModes: readJSON<ModePreset[]>(CUSTOM_KEY, []),
  lastCustom: readJSON<ModeConstraints>(LAST_CUSTOM_KEY, EMPTY_CONSTRAINTS),
  upsert: (m) => {
    const next = [...get().customModes.filter((x) => x.id !== m.id), m]
    writeJSON(CUSTOM_KEY, next)
    set({ customModes: next })
  },
  remove: (id) => {
    const next = get().customModes.filter((x) => x.id !== id)
    writeJSON(CUSTOM_KEY, next)
    set({ customModes: next })
  },
  setLastCustom: (c) => {
    writeJSON(LAST_CUSTOM_KEY, c)
    set({ lastCustom: c })
  },
}))

/** 全量模式表：内置 + 用户自定义（下拉菜单的数据源） */
export function allModes(customModes: ModePreset[]): ModePreset[] {
  return [...BUILTIN_MODES, ...customModes]
}

/** 多行约束输入框的通用解析：每行一条，去空白行 */
export function splitLines(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}
