// dev-only 原语陈列页 —— **交付前删除**（Track C 全部页面迁移完成后连同本文件一起删）
// ------------------------------------------------------------
// 入口：/?primitives 查询参数（main.tsx 判定，不进导航、不进产物路由）。
// 职责：按原语分节渲染**全部变体与全部状态**（hover/focus 无法静态化，
// 由 :focus-visible 自然呈现）——它是 axe（verify-a11y）的靶子，
// 也是 2.10 对比度/键盘/reduced-motion 实测的唯一页面。
// 每节 <section aria-labelledby> + 标题；交互组件一律受控。
import { useMemo, useState } from 'react'
import { FileText, Inbox, Pause, Pencil, Play, Settings, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Kbd,
  LangPicker,
  Modal,
  NumberField,
  Popover,
  Progress,
  Segmented,
  Skeleton,
  Slider,
  Spinner,
  Surface,
  Switch,
  Textarea,
  toast,
  ToastHost,
  Tooltip,
  useToastStore,
  type Column,
  type Lang,
} from '../components/ui/index'

interface DemoRow {
  id: number
  index: number
  tc: string
  source: string
  target: string
  state: 'done' | 'pending' | 'failed'
}
// 注意：并存期旧 src/components/ui.tsx 会遮蔽 '../components/ui' 短路径（文件优先于目录），
// 故显式导入 ui/index；Track C 删除旧 ui.tsx 后可改回短路径。

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-title text-ink1">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="num w-40 shrink-0 text-micro text-ink3 uppercase">{label}</span>
      {children}
    </div>
  )
}

export default function PrimitivesPage() {
  const [segA, setSegA] = useState<'翻译' | '字幕' | '模型'>('翻译')
  const [segB, setSegB] = useState<'A' | 'B' | 'C'>('A')
  const [sw1, setSw1] = useState(true)
  const [sw2, setSw2] = useState(false)
  const [cb1, setCb1] = useState(true)
  const [cb2, setCb2] = useState(false)
  const [cb3, setCb3] = useState(false)
  const [num, setNum] = useState(4)
  const [slide, setSlide] = useState(30)
  const [text, setText] = useState('')
  const [pop, setPop] = useState(false)
  const [lang, setLang] = useState('zh')
  const [modal, setModal] = useState(false)
  const [confirmModal, setConfirmModal] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const toasts = useToastStore((s) => s.toasts)
  const [sel, setSel] = useState<Set<string | number>>(new Set())

  const bigRows: DemoRow[] = useMemo(
    () =>
      Array.from({ length: 5000 }, (_, i) => ({
        id: i,
        index: i,
        tc: `${String(Math.floor(i / 600)).padStart(2, '0')}:${String(Math.floor((i % 600) / 10)).padStart(2, '0')}:${(i % 10) * 10}`,
        source: `源文第 ${i + 1} 行——用于验证虚拟化在千行级数据下的表现`,
        target: i % 3 === 0 ? `译文第 ${i + 1} 行` : '',
        state: i % 17 === 0 ? 'failed' : i % 3 === 0 ? 'done' : 'pending',
      })),
    [],
  )
  const smallRows = bigRows.slice(0, 12)

  const demoColumns: Column<DemoRow>[] = [
    { key: 'index', header: '#', width: '56px', numeric: true, render: (r) => r.index + 1 },
    { key: 'tc', header: '时间码', width: '110px', numeric: true, render: (r) => r.tc },
    { key: 'source', header: '原文', render: (r) => r.source },
    { key: 'state', header: '状态', width: '110px', render: (r) => (
      <Badge tone={r.state === 'done' ? 'ok' : r.state === 'failed' ? 'danger' : 'neutral'} dot>
        {r.state === 'done' ? '完成' : r.state === 'failed' ? '失败' : '待翻译'}
      </Badge>
    ) },
    {
      key: 'actions',
      header: '操作',
      width: '72px',
      render: (r) => (
        <span className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-(--suj-dur-quick) group-hover:opacity-100 group-focus-within:opacity-100">
          <IconButton label={`编辑第 ${r.index + 1} 行`} icon={<Pencil size={14} />} size="sm" />
          <IconButton label={`重试第 ${r.index + 1} 行`} icon={<Play size={14} />} size="sm" />
        </span>
      ),
    },
  ]

  const demoLangs: Lang[] = [
    { code: 'zh', zhName: '简体中文', enName: 'Chinese Simplified', core: true },
    { code: 'zh-TW', zhName: '繁體中文', enName: 'Chinese Traditional' },
    { code: 'en', zhName: '英语', enName: 'English', core: true },
    { code: 'ja', zhName: '日语', enName: 'Japanese', core: true },
    { code: 'ko', zhName: '韩语', enName: 'Korean', core: true },
    { code: 'de', zhName: '德语', enName: 'German' },
    { code: 'fr', zhName: '法语', enName: 'French' },
    { code: 'es', zhName: '西班牙语', enName: 'Spanish' },
    { code: 'ru', zhName: '俄语', enName: 'Russian' },
    { code: 'pt', zhName: '葡萄牙语', enName: 'Portuguese' },
  ]

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-display text-ink1">素笺 · 原语陈列</h1>
        <p className="text-caption text-ink3">
          dev-only 页面（/?primitives）。展示全部原语的变体与状态，是 a11y / 对比度 /
          键盘 / reduced-motion 门禁的实测靶子。交付前删除。
        </p>
      </header>

      <Section id="sec-button" title="Button（§5.1）">
        <Row label="primary">
          <Button kind="primary">开始翻译</Button>
          <Button kind="primary" size="sm">
            小
          </Button>
          <Button kind="primary" size="lg">
            大
          </Button>
        </Row>
        <Row label="secondary">
          <Button>次级动作</Button>
          <Button size="sm">小</Button>
          <Button size="lg">大</Button>
        </Row>
        <Row label="ghost">
          <Button kind="ghost">幽灵</Button>
        </Row>
        <Row label="danger">
          <Button kind="danger">删除模型</Button>
        </Row>
        <Row label="loading">
          <Button kind="primary" loading>
            翻译中
          </Button>
          <Button loading>排队中</Button>
        </Row>
        <Row label="disabled">
          <Button kind="primary" disabled>
            不可用
          </Button>
          <Button disabled>不可用</Button>
        </Row>
      </Section>

      <Section id="sec-icon-button" title="IconButton（§5.1）">
        <Row label="sizes">
          <IconButton label="暂停" icon={<Pause size={16} />} size="sm" />
          <IconButton label="播放" icon={<Play size={16} />} />
          <IconButton label="设置" icon={<Settings size={16} />} size="lg" />
        </Row>
        <Row label="disabled / loading">
          <IconButton label="删除（不可用）" icon={<Trash2 size={16} />} disabled />
          <IconButton label="加载中" icon={<Play size={16} />} loading />
        </Row>
      </Section>

      <Section id="sec-badge" title="Badge（§5.2）">
        <Row label="tones">
          <Badge>默认</Badge>
          <Badge tone="accent" dot>
            下载中
          </Badge>
          <Badge tone="ok" dot>
            就绪
          </Badge>
          <Badge tone="warn" dot>
            需检查
          </Badge>
          <Badge tone="danger" dot>
            失败
          </Badge>
        </Row>
        <Row label="无点">
          <Badge tone="ok">完成 12</Badge>
          <Badge tone="danger">失败 3</Badge>
        </Row>
      </Section>

      <Section id="sec-segmented" title="Segmented（§5.3，方向键 / Home / End）">
        <Row label="md 受控">
          <Segmented aria-label="主导航示例" options={['翻译', '字幕', '模型'] as const} value={segA} onChange={setSegA} />
        </Row>
        <Row label="sm / lg">
          <Segmented aria-label="小尺寸示例" size="sm" options={['A', 'B', 'C'] as const} value={segB} onChange={setSegB} />
          <Segmented aria-label="大尺寸示例" size="lg" options={['A', 'B', 'C'] as const} value={segB} onChange={setSegB} />
        </Row>
        <p className="text-caption text-ink3">
          当前值：<span className="num">{segA} · {segB}</span>
        </p>
      </Section>

      <Section id="sec-switch" title="Switch（§5.4，Space / Enter）">
        <Row label="on / off">
          <Switch checked={sw1} onChange={setSw1} label="保持加载" />
          <Switch checked={sw2} onChange={setSw2} label="开机自启" />
        </Row>
        <Row label="disabled">
          <Switch checked={true} onChange={() => {}} label="强制项" disabled />
        </Row>
        <Row label="srOnly">
          <Switch checked={sw1} onChange={setSw1} label="仅可访问名开关" srOnly />
          <span className="text-caption text-ink3">← 与第一枚同状态</span>
        </Row>
      </Section>

      <Section id="sec-checkbox" title="Checkbox（§5.7，16px / indeterminate）">
        <div className="flex flex-col gap-3">
          <Checkbox checked={cb1} onChange={setCb1} label="导出双语" />
          <Checkbox checked={cb2} onChange={setCb2} label="含时间戳" />
          <Checkbox checked={cb3} onChange={setCb3} label="部分选中示例" indeterminate={cb1 && cb2 ? false : cb1 || cb2} />
          <Checkbox checked={false} onChange={() => {}} label="不可用" disabled />
        </div>
      </Section>

      <Section id="sec-kbd" title="Kbd">
        <Row label="单键 / 组合">
          <Kbd keys={['Esc']} />
          <Kbd keys={['Ctrl', 'K']} />
          <Kbd keys={['Shift', '→', 'End']} />
        </Row>
      </Section>

      <Section id="sec-spinner" title="Spinner（唯一 linear 动效）">
        <Row label="sizes">
          <Spinner size={14} className="text-accent" />
          <Spinner size={20} className="text-accent" />
          <Spinner size={28} className="text-accent" />
        </Row>
      </Section>

      <Section id="sec-icons" title="图标基线（lucide / stroke 1.75）">
        <Row label="16px 线性">
          <FileText size={16} strokeWidth={1.75} className="text-ink2" aria-hidden="true" />
          <Trash2 size={16} strokeWidth={1.75} className="text-ink2" aria-hidden="true" />
          <Settings size={16} strokeWidth={1.75} className="text-ink2" aria-hidden="true" />
        </Row>
      </Section>

      <Section id="sec-field" title="Field / Input（§5.5，label 必填）">
        <div className="grid max-w-md grid-cols-1 gap-5">
          <Field label="模型目录" placeholder="C:\models" hint="GGUF 文件所在目录" />
          <Field label="检索关键词" placeholder="输入以过滤" size="sm" />
          <Field label="API 地址" defaultValue="http://localhost:8080" error="端口已被占用，请更换" />
          <Field label="禁用态" placeholder="不可编辑" disabled />
        </div>
      </Section>

      <Section id="sec-number" title="NumberField（mono + 右对齐）">
        <div className="max-w-xs">
          <NumberField label="并发数" value={num} onChange={setNum} min={1} max={16} step={1} hint="1–16" />
        </div>
        <p className="num text-caption text-ink3">当前 = {num}</p>
      </Section>

      <Section id="sec-textarea" title="Textarea（§5.5）">
        <div className="flex w-full flex-col gap-6">
          <Textarea label="原文" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <Textarea label="译文（阅读态 · 72ch 限宽）" rows={3} read defaultValue="译文文本块以 15.5px / 1.9 行高呈现，限宽 72ch 并在栏内居中。" />
          <Textarea label="带错误" rows={2} error="内容超出上限" />
        </div>
      </Section>

      <Section id="sec-slider" title="Slider（原生 range + accent）">
        <div className="max-w-md">
          <Slider label="上下文窗口" min={0} max={100} value={slide} onChange={setSlide} formatValue={(n) => `${n}%`} />
        </div>
      </Section>

      <Section id="sec-surface" title="Surface（§5.8，无边框无阴影）">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Surface>
            <p className="text-body text-ink1">阅读态 · padding 24</p>
          </Surface>
          <Surface dense>
            <p className="text-body text-ink1">操作态 · padding 16</p>
          </Surface>
        </div>
      </Section>

      <Section id="sec-empty" title="EmptyState（§5.10，无点阵背景）">
        <Surface>
          <EmptyState
            icon={<Inbox size={48} strokeWidth={1.5} />}
            title="还没有术语"
            body="导入 CSV 或手动添加第一条术语，翻译时将自动匹配。"
            action={
              <Button kind="primary" size="lg">
                导入术语
              </Button>
            }
          />
        </Surface>
      </Section>

      <Section id="sec-skeleton" title="Skeleton（§5.11，opacity shimmer）">
        <div className="flex w-full max-w-md flex-col gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton rows={4} />
        </div>
      </Section>

      <Section id="sec-progress" title="Progress（scaleX 填充）">
        <div className="flex w-full max-w-md flex-col gap-4">
          <Progress pct={30} label="模型下载进度" />
          <Progress pct={72} tone="ok" label="字幕队列进度" />
          <Progress pct={90} tone="warn" label="显存占用" />
          <Progress pct={100} label="已完成" />
        </div>
      </Section>

      <Section id="sec-popover" title="Popover（§5.9，Esc / 点外部关闭）">
        <Button kind="secondary" aria-expanded={pop} onClick={() => setPop((v) => !v)}>
          {pop ? '关闭浮层' : '打开浮层'}
        </Button>
        <Popover open={pop} onClose={() => setPop(false)} anchorRef={{ current: null }}>
          <p className="text-body text-ink1">浮层内容（role=dialog，非模态）</p>
          <p className="text-caption text-ink3">Esc / 点击外部关闭，焦点回到触发按钮。</p>
        </Popover>
      </Section>

      <Section id="sec-langpicker" title="LangPicker（§5.6，虚拟化 listbox）">
        <div className="flex flex-wrap items-end gap-6">
          <LangPicker
            langs={demoLangs}
            value={lang}
            onChange={setLang}
            isSource
            detected="ja"
            recent={['en', 'ko']}
            label="源语言"
          />
          <span className="text-caption text-ink3">
            当前：<span className="num">{lang}</span>（触发器副行展示 DETECTED）
          </span>
        </div>
      </Section>

      <Section id="sec-tooltip" title="Tooltip（400ms 延迟 / 键盘聚焦可触发）">
        <Row label="hover / Tab">
          <Tooltip content="开始翻译任务（Ctrl+Enter）">
            <Button kind="primary">翻译</Button>
          </Tooltip>
          <Tooltip content="原生按钮也能承载 tooltip">
            <button type="button" className="text-body text-accent underline underline-offset-2">
              链接式触发
            </button>
          </Tooltip>
        </Row>
        <p className="text-caption text-ink3">IconButton 自带 tooltip（label 即提示），无需再包一层。</p>
      </Section>

      <Section id="sec-modal" title="Modal（§5.9，焦点陷入 / Esc / 焦点归还）">
        <Row label="普通">
          <Button onClick={() => setModal(true)}>打开 Modal</Button>
        </Row>
        <Row label="破坏性确认">
          <Button kind="danger" onClick={() => setConfirmModal(true)}>
            删除模型…
          </Button>
        </Row>
      </Section>

      <Section id="sec-drawer" title="Drawer（右滑出 360/420）">
        <Button onClick={() => setDrawer(true)}>打开术语本抽屉</Button>
      </Section>

      <Section id="sec-toast" title={`Toast（右下 · 上限 3 · 当前 ${toasts.length} 条）`}>
        <Row label="四种 tone">
          <Button size="sm" onClick={() => toast.push({ tone: 'info', message: '已切换到系统主题。' })}>
            info
          </Button>
          <Button size="sm" onClick={() => toast.push({ tone: 'ok', message: '校验通过：SHA256 一致。' })}>
            ok
          </Button>
          <Button size="sm" onClick={() => toast.push({ tone: 'warn', message: '显存余量不足 2 GB。' })}>
            warn
          </Button>
          <Button
            size="sm"
            onClick={() => toast.push({ tone: 'error', message: '下载失败：SHA256SUMS 不可达（不会自动消失）。' })}
          >
            error
          </Button>
        </Row>
        <Row label="带动作">
          <Button
            size="sm"
            onClick={() =>
              toast.push({
                tone: 'info',
                message: '已导入 128 条术语。',
                action: { label: '查看', run: () => toast.push({ tone: 'ok', message: '已打开术语本。' }) },
              })
            }
          >
            action
          </Button>
        </Row>
      </Section>

      {/* ── 受控浮层实例（陈列页挂载 ToastHost 供上面按钮演示）── */}
      <ToastHost />

      <Modal open={modal} onClose={() => setModal(false)} title="导出字幕">
        <p>将以当前格式导出全部字幕行，已翻译行使用最新译文。</p>
        <Field className="mt-3" label="导出文件名" defaultValue="episode-01" />
        footer 按钮通过 data-modal-initial 标记初始焦点目标。
      </Modal>
      <Modal
        open={confirmModal}
        onClose={() => setConfirmModal(false)}
        title="删除模型？"
        initialFocus="cancel"
        footer={
          <>
            <Button data-modal-initial="cancel" onClick={() => setConfirmModal(false)}>
              取消
            </Button>
            <Button
              kind="danger"
              data-modal-initial="confirm"
              onClick={() => {
                setConfirmModal(false)
                toast.push({ tone: 'ok', message: '已删除模型（演示）。' })
              }}
            >
              删除
            </Button>
          </>
        }
      >
        <p>此操作不可恢复。删除后如需再次使用须重新下载模型文件。</p>
      </Modal>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="术语本">
        <p className="text-body text-ink2">抽屉内容。宽度 360（术语本 420），左侧圆角 --radius-lg。</p>
        <p className="mt-2 text-caption text-ink3">Tab 在抽屉内循环；Esc 关闭；焦点回到触发按钮。</p>
      </Drawer>

      <Section id="sec-datatable" title="DataTable（§5.7 · 5000 行虚拟化 · 键盘 ↑↓/Space/Enter）">
        <p className="text-caption text-ink3">
          上表 5000 行（虚拟滚动只渲染可视窗口 + 12 行缓冲）。容器聚焦后 ↑↓ 移动、Home/End
          跳首尾、Space 勾选、Enter 触发行点击；Shift+点击 连选。
        </p>
        <div className="h-96 overflow-hidden rounded-md bg-surface">
          <DataTable
            aria-label="5000 行虚拟化演示表"
            columns={demoColumns}
            rows={bigRows}
            rowKey={(r) => r.id}
            selectable
            selected={sel}
            onSelectedChange={setSel}
            onRowClick={() => {}}
          />
        </div>
        <p className="num text-caption text-ink3">已选 {sel.size} 行（选中数由调用方读 selected.size 展示在工具栏）</p>
      </Section>

      <Section id="sec-datatable-small" title="DataTable（舒适态 40px 行 + 空态）">
        <div className="mb-4 h-56 overflow-hidden rounded-md bg-surface">
          <DataTable
            aria-label="12 行舒适态演示表"
            columns={demoColumns.slice(0, 4)}
            rows={smallRows}
            rowKey={(r) => r.id}
            rowHeight={40}
          />
        </div>
        <Surface dense>
          <DataTable
            aria-label="空态演示表"
            columns={demoColumns.slice(0, 3)}
            rows={[]}
            rowKey={(r) => r.id}
            emptyState={
              <EmptyState
                icon={<Inbox size={48} strokeWidth={1.5} />}
                title="没有失败的行"
                body="全部行翻译完成后这里将保持为空。"
              />
            }
          />
        </Surface>
      </Section>

      <Section id="sec-datatable-actions" title="行内操作（opacity 显现，始终在 Tab 序内）">
        <p className="text-caption text-ink3">
          用 opacity-0 + group-hover/focus-within 显现（禁止 display:none——会脱离 Tab 序）。
          键盘 Tab 到按钮时同样显现。
        </p>
      </Section>
    </main>
  )
}
