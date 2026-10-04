// dev-only 原语陈列页 —— **交付前删除**（Track C 全部页面迁移完成后连同本文件一起删）
// ------------------------------------------------------------
// 入口：/?primitives 查询参数（main.tsx 判定，不进导航、不进产物路由）。
// 职责：按原语分节渲染**全部变体与全部状态**（hover/focus 无法静态化，
// 由 :focus-visible 自然呈现）——它是 axe（verify-a11y）的靶子，
// 也是 2.10 对比度/键盘/reduced-motion 实测的唯一页面。
// 每节 <section aria-labelledby> + 标题；交互组件一律受控。
import { useState } from 'react'
import { FileText, Pause, Play, Settings, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  IconButton,
  Kbd,
  Segmented,
  Spinner,
  Switch,
} from '../components/ui/index'
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
    </main>
  )
}
