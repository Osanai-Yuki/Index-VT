// 翻译模式（领域约束模板）· Track C 2026-10-06
// ------------------------------------------------------------
// 模式 = 一组预填的 Constraints（Hard / Soft / Genre / JSONPreserve），
// 与约束抽屉共用同一数据形态；术语本（Glossary）独立于模式，不随切换重置。
//
// 内置五个领域模板：standard 完全对齐官方 translate.py 的无约束默认
//（无硬/软约束、genre=文本），其余四个为常见领域的常用约束组合。
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

export const BUILTIN_MODES: ModePreset[] = [
  {
    id: 'standard',
    name: '通用翻译',
    description: '官方默认：不加任何硬/软约束，文体"文本"，最通用',
    builtin: true,
    constraints: { hard: [], soft: [], genre: '文本', jsonPreserve: false },
  },
  {
    id: 'politics-finance',
    name: '政治经济·社科金融',
    description: '时政财经研报体：数字零误差、专名规范译法、立场中性、术语统一',
    builtin: true,
    constraints: {
      genre: '时政与财经',
      hard: [
        '机构名、法规名、政策文件名按目标语言官方/通行译名翻译，首次出现时括注原文',
        '货币金额、汇率、指数点位、百分比等数字必须与原文完全一致，不得四舍五入或换算',
        '职务头衔按目标语言官方惯例翻译，不得臆造',
        '对有争议的政治表述保持中性并忠实原文立场，不作阐释、评价或软化',
      ],
      soft: [
        '同一术语全篇统一译法',
        '缩略语首次出现给出全称，之后可用缩写',
        '语气正式、客观，符合新闻通稿或研究报告文体',
      ],
      jsonPreserve: false,
    },
  },
  {
    id: 'tech-ai',
    name: '计算机·人工智能',
    description: '技术文档体：标识符与代码不译、术语从社区惯例、中英混排留空格',
    builtin: true,
    constraints: {
      genre: '科技',
      hard: [
        'API 名、库名、命令、代码标识符、文件路径、配置键名、报错信息原样保留，不得翻译',
        '模型、框架、数据集等专有名词（如 Transformer、PyTorch）保留英文',
        '无通行译法的技术术语保留英文原文，可首次出现时括注建议译名',
        '版本号、超参数名、计量单位保持原样，不得改写',
      ],
      soft: [
        '术语译法参照目标语言技术社区通行惯例，全篇一致',
        '中英混排时英文词两侧各留一个空格',
        '行文简洁精确，符合技术文档文体；长句可按目标语言习惯断句，但不得改变逻辑限定关系',
      ],
      jsonPreserve: false,
    },
  },
  {
    id: 'humanities',
    name: '人文写作',
    description: '文学与人文体：可读性优先、保留修辞与语气、通行译名',
    builtin: true,
    constraints: {
      genre: '文学与人文',
      hard: [
        '人名、地名采用目标语言通行译名；无通行译名时音译并首次括注原文',
        '书名、作品名按目标语言惯用译名，无法确认时保留原文并括注',
        '不得增删或改写比喻、排比、双关等修辞结构',
      ],
      soft: [
        '在忠实前提下以可读性与文学性优先，允许调整语序',
        '保留原文的语气、语域与时代感，避免翻译腔',
        '同一人物/概念的称谓全篇统一',
      ],
      jsonPreserve: false,
    },
  },
  {
    id: 'medical-bio',
    name: '医疗生物',
    description: '医学与生命科学体：INN 通用名、剂量单位零误差、基因符号保留',
    builtin: true,
    constraints: {
      genre: '医学与生命科学',
      hard: [
        '药品名使用国际非专利通用名（INN），商品名首次出现时保留原文括注',
        '疾病、解剖学、药理学术语按目标语言医学规范译法；基因/蛋白符号保留原文',
        '剂量、单位、浓度、临床试验编号（如 NCT 编号）必须与原文完全一致',
        '存在多种译法或译义不唯一的术语，首次出现时括注原文',
      ],
      soft: [
        '术语全篇统一，符合医学文献文体',
        '表述严谨，避免模糊或绝对化措辞',
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
