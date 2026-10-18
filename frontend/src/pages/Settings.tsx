// 设置页（01 文档 §6.4）· Track C 迁移版（2026-10-06）
// 推理 / 资源 / 下载 / 外观与数据 / 关于。
// Track C：主题与字号控件真正可改（theme.ts applyTheme/applyFontSize + 配置持久化）；
// confirm/alert 下线（Modal 破坏性确认 + toast）；新原语组合 + 瑞士 token。
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Badge, Button, Field, Modal, Segmented, Switch, Textarea } from '../components/ui/index'
import { ModeDetails } from '../components/ModeDetails'
import { GlossaryManager } from '../components/GlossaryManager'
import { applyFontSize, applyTheme, type FontSize, type ThemeMode } from '../theme/theme'
import { BUILTIN_MODES, splitLines, useModeStore, type ModePreset } from '../lib/modes'
import { toast } from '../stores/toastStore'
import { apiGetConfig, apiSetConfig, apiCollectLogs, apiClearLogs, apiClearHistory, apiOpenLogsFolder, apiEstimateCtxVRAM } from '../wailsapi'

const numInputCls =
  'bg-sunken border border-line text-ink1 text-center num w-22 py-1.5'

/* Row 必须在模块作用域：定义在组件体内会让每次渲染生成新的组件类型，
   React 因此卸载重建整棵 Row 子树 —— 直接后果是输入框敲一个字就丢焦点
   （setCfg → 重渲染 → 重建），以及 Modal 打开时触发按钮节点被销毁、
   关闭后焦点归还失败（useDismissable 记录的元素已脱离文档）。 */
function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-t border-line">
      <div>
        <div className="text-body font-semibold">{title}</div>
        {desc && <div className="text-caption text-ink2 mt-0.5">{desc}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2.5">{children}</div>
    </div>
  )
}

export function SettingsPage() {
  const [cfg, setCfg] = useState<any>(null)
  const [saved, setSaved] = useState(false)
  const [savedTimer, setSavedTimer] = useState<number | null>(null)
  const [logsPath, setLogsPath] = useState('')
  const [clearingLogs, setClearingLogs] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  // 自定义翻译模式编辑器（null = 关闭；id null = 新建）
  const [modeEditor, setModeEditor] = useState<{
    id: string | null
    name: string
    description: string
    hard: string
    soft: string
    genre: string
    jsonPreserve: boolean
  } | null>(null)
  // ctx 自定义档（Task C）：输入以 K 为单位，保存在 config.inference.ctxTokensOverride（token 数）
  const [ctxDraftK, setCtxDraftK] = useState<number | null>(null)
  const [ctxEst, setCtxEst] = useState<any | null>(null)
  const [pendingCtxTok, setPendingCtxTok] = useState<number | null>(null)
  // 约束模板详情（内置模板只读查看；自定义模板走「编辑」即可看全字段）
  const [detailMode, setDetailMode] = useState<ModePreset | null>(null)
  const customModes = useModeStore((s) => s.customModes)

  useEffect(() => {
    apiGetConfig().then(setCfg).catch(() => {})
  }, [])

  useEffect(() => () => {
    if (savedTimer !== null) window.clearTimeout(savedTimer)
  }, [])

  const save = (patch: any) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    apiSetConfig(next)
      .then(() => {
        setSaved(true)
        if (savedTimer !== null) window.clearTimeout(savedTimer)
        const t = window.setTimeout(() => setSaved(false), 1500)
        setSavedTimer(t)
      })
      .catch((e) => {
        apiGetConfig().then(setCfg).catch(() => {})
        toast.push({ tone: 'error', message: String((e as { message?: string })?.message ?? e) })
      })
  }

  // ── ctx 自定义档（C3）────────────────────────────────────────
  // ctxSel 的"自定义"有两个来源：已落库的 override，或本次会话里刚点开还没提交的草稿
  // （ctxDraftK !== null）。少了后者，点「自定义」会被 value 推导弹回预设档、子行永不出现。
  const ctxOverride: number = cfg?.inference?.ctxTokensOverride ?? 0
  const ctxSel: string = ctxOverride > 0 || ctxDraftK !== null ? '自定义' : (cfg?.inference?.ctxTier ?? '8K')

  useEffect(() => {
    if (ctxOverride > 0) setCtxDraftK(Math.round(ctxOverride / 1024))
  }, [ctxOverride])

  // 输入去抖 300ms 拉估算（只更新状态行，不落库）
  useEffect(() => {
    if (ctxSel !== '自定义' || ctxDraftK == null) return
    const t = window.setTimeout(() => {
      const tok = Math.max(2048, Math.min(65536, Math.round(ctxDraftK) * 1024))
      apiEstimateCtxVRAM(tok).then(setCtxEst).catch(() => setCtxEst(null))
    }, 300)
    return () => window.clearTimeout(t)
  }, [ctxSel, ctxDraftK])

  // ── 预设档显存门（F-08b）────────────────────────────────────
  // 三个预设档各拉一次估算：超可用显存的档位置灰（title 给原因），32K 挂「推荐」
  // 徽标（F-08 验收档位）。当前选中值不置灰——落库后 GPU 条件变化不能锁死用户，
  // 此时的超出由状态行如实呈现。估算失败（无 GPU/接口异常）不门禁，行为同旧版。
  const [presetEst, setPresetEst] = useState<Record<string, any>>({})
  useEffect(() => {
    let alive = true
    const tiers = ['8K', '16K', '32K'] as const
    const TOK: Record<(typeof tiers)[number], number> = { '8K': 8192, '16K': 16384, '32K': 32768 }
    Promise.all(
      tiers.map((k) => apiEstimateCtxVRAM(TOK[k]).then((e) => [k, e] as const).catch(() => [k, null] as const)),
    ).then((entries) => {
      if (!alive) return
      const next: Record<string, any> = {}
      for (const [k, e] of entries) if (e) next[k] = e
      setPresetEst(next)
    })
    return () => {
      alive = false
    }
  }, [])

  const presetMeta = useMemo(() => {
    const meta: Record<string, { disabled?: boolean; badge?: string; title?: string }> = {
      '32K': { badge: '推荐' },
    }
    for (const k of ['8K', '16K', '32K']) {
      const est = presetEst[k]
      if (est?.gpu?.present && est.exceedsFree && ctxSel !== k) {
        meta[k] = { ...meta[k], badge: undefined, disabled: true, title: '预计显存占用超过当前可用显存' }
      }
    }
    return meta
  }, [presetEst, ctxSel])

  // 当前选中的预设档也显示占用状态行（与自定义档同一口径，数字来自同一估算接口）
  const selPresetEst = ctxSel !== '自定义' ? presetEst[ctxSel] : null
  // 当前生效估算：自定义档 = 去抖草稿估算；预设档 = 装载时快照
  const activeEst = ctxSel === '自定义' ? ctxEst : selPresetEst

  const onCtxSelect = (v: string) => {
    if (v === '自定义') {
      setCtxDraftK(Math.max(2, Math.round(ctxOverride / 1024)) || 8)
      return
    }
    setCtxDraftK(null)
    setCtxEst(null)
    save({ inference: { ...cfg.inference, ctxTier: v, ctxTokensOverride: 0 } })
  }

  // 失焦提交：先取一次新鲜估算，超限走确认 Modal，否则直接落库
  const commitCtx = async (k: number) => {
    const tok = Math.max(2048, Math.min(65536, Math.round(k) * 1024))
    const est = await apiEstimateCtxVRAM(tok).catch(() => null)
    setCtxEst(est)
    if (est?.exceedsFree) {
      setPendingCtxTok(tok)
      return
    }
    save({ inference: { ...cfg.inference, ctxTokensOverride: tok } })
  }

  const setThemeMode = (label: string) => {
    const mode: ThemeMode = label === '浅色' ? 'light' : label === '深色' ? 'dark' : 'system'
    applyTheme(mode) // localStorage + <html data-theme> 立即生效
    save({ appearance: { ...cfg.appearance, theme: mode } })
  }

  const setFontSize = (label: string) => {
    const size: FontSize = label === '小' ? 'small' : label === '大' ? 'large' : 'standard'
    applyFontSize(size)
    save({ appearance: { ...cfg.appearance, fontSize: size } })
  }

  // ── 自定义翻译模式（预留接口的配置面：增删改，落 localStorage）──
  const openNewMode = () =>
    setModeEditor({ id: null, name: '', description: '', hard: '', soft: '', genre: '', jsonPreserve: false })

  const openEditMode = (m: ModePreset) =>
    setModeEditor({
      id: m.id,
      name: m.name,
      description: m.description,
      hard: m.constraints.hard.join('\n'),
      soft: m.constraints.soft.join('\n'),
      genre: m.constraints.genre,
      jsonPreserve: m.constraints.jsonPreserve,
    })

  const saveMode = () => {
    if (!modeEditor) return
    if (!modeEditor.name.trim()) {
      toast.push({ tone: 'warn', message: '模式名称不能为空' })
      return
    }
    const preset: ModePreset = {
      id: modeEditor.id ?? `custom-${Date.now().toString(36)}`,
      name: modeEditor.name.trim(),
      description: modeEditor.description.trim() || '自定义约束模板',
      constraints: {
        hard: splitLines(modeEditor.hard),
        soft: splitLines(modeEditor.soft),
        genre: modeEditor.genre.trim(),
        jsonPreserve: modeEditor.jsonPreserve,
      },
    }
    useModeStore.getState().upsert(preset)
    setModeEditor(null)
    toast.push({ tone: 'ok', message: `已保存自定义模式：${preset.name}` })
  }

  if (!cfg) return <div className="text-caption text-ink3">加载配置…</div>

  const appearanceTheme: ThemeMode = cfg.appearance?.theme ?? 'system'
  const appearanceFontSize: FontSize = cfg.appearance?.fontSize ?? 'standard'

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4 overflow-auto h-full screen-in pb-6">
      {/* 推理 */}
      <div className="bg-surface border border-line pb-1.5">
        <div className="px-5 pt-4 pb-2">
          <span className="text-micro uppercase tracking-caps text-ink3">
            推理 · <b className="text-ink2 font-medium">INFERENCE</b>
          </span>
        </div>
        <Row title="GPU 层数卸载（-ngl）" desc="0 = 纯 CPU；99 = 全部层上卡；-1 = 自动">
          <input
            aria-label="GPU 层数卸载（-ngl）"
            className={numInputCls}
            value={cfg.inference.nglOverride}
            onChange={(e) => setCfg({ ...cfg, inference: { ...cfg.inference, nglOverride: parseInt(e.target.value || '0', 10) || 0 } })}
            onBlur={() => save({ inference: cfg.inference })}
          />
          <Button kind="ghost" onClick={() => save({ inference: { ...cfg.inference, nglOverride: -1 } })}>
            恢复默认
          </Button>
        </Row>
        <Row title="上下文档位" desc="影响 KV cache 显存占用；超出可用显存的档位会被置灰">
          <Segmented<string>
            options={['8K', '16K', '32K', '自定义']}
            value={ctxSel}
            aria-label="上下文档位"
            optionMeta={presetMeta}
            onChange={onCtxSelect}
          />
        </Row>
        {ctxSel === '自定义' && (
          <Row title="上下文长度" desc="2K–64K，步进 1K">
            <input
              aria-label="上下文长度（单位 K）"
              className={numInputCls}
              type="number"
              min={2}
              max={64}
              step={1}
              value={ctxDraftK ?? 8}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (!Number.isNaN(n)) setCtxDraftK(n)
              }}
              onBlur={() => commitCtx(ctxDraftK ?? 8)}
            />
            <span className="text-caption text-ink3">K</span>
          </Row>
        )}
        {activeEst && (
          <div className={`px-5 pb-3 -mt-2 text-caption ${activeEst.exceedsFree && activeEst.gpu?.present ? 'text-danger' : 'text-ink3'}`}>
            {activeEst.gpu?.present
              ? `预计占用 ${(activeEst.totalMiB / 1024).toFixed(1)} GB / 当前可用 ${(activeEst.gpu.freeMB / 1024).toFixed(1)} GB`
              : `CPU 模式：无显存可估，ctx 越大越慢（预计内存 ${(activeEst.totalMiB / 1024).toFixed(1)} GB）`}
            {activeEst.exceedsFree && activeEst.gpu?.present
              ? (ctxSel === '自定义' ? ' —— 超过可用显存，保存前会再确认' : ' —— 超过可用显存，请选更低档位')
              : ''}
          </div>
        )}
        <Row title="CPU 线程数" desc="CPU 推理与 KV 分层时生效；0 = 自动">
          <input
            aria-label="CPU 线程数"
            className={numInputCls}
            value={cfg.inference.cpuThreads}
            onChange={(e) => setCfg({ ...cfg, inference: { ...cfg.inference, cpuThreads: parseInt(e.target.value || '0', 10) || 0 } })}
            onBlur={() => save({ inference: cfg.inference })}
          />
        </Row>
        <Row title="温度覆盖（高级）" desc="三模型默认参数已最优：Translate/Nailong 0 · Homura 0.3">
          <Switch
            checked={cfg.inference.tempOverride}
            onChange={(v) => save({ inference: { ...cfg.inference, tempOverride: v } })}
            label="温度覆盖"
            srOnly
          />
        </Row>
      </div>

      {/* 资源 */}
      <div className="bg-surface border border-line pb-1.5">
        <div className="px-5 pt-4 pb-2">
          <span className="text-micro uppercase tracking-caps text-ink3">
            资源 · <b className="text-ink2 font-medium">RESOURCES</b>
          </span>
        </div>
        <Row title="无操作后释放" desc="连续 30 分钟无鼠标、滚动或键盘操作，且没有翻译任务时，提示倒计时 30 秒；任何操作都会取消倒计时">
          <span className="text-body text-ink2 whitespace-nowrap">30 分钟 + 30 秒</span>
        </Row>
        <Row title="启动时加载" desc="打开程序后加载默认模型及已保存的上下文设置；首次默认 Translate / 8K">
          <span className="text-body text-ink2 whitespace-nowrap">自动加载</span>
        </Row>
        <Row title="关闭程序时" desc="退出即释放全部资源（推荐）">
          <Segmented<string>
            options={['退出即释放']}
            value="退出即释放"
            aria-label="关闭行为"
            onChange={() => {}}
          />
        </Row>
      </div>

      {/* 下载 */}
      <div className="bg-surface border border-line pb-1.5">
        <div className="px-5 pt-4 pb-2">
          <span className="text-micro uppercase tracking-caps text-ink3">
            下载 · <b className="text-ink2 font-medium">DOWNLOAD</b>
          </span>
        </div>
        <Row title="模型下载源" desc="自动探测按连通性与延迟择优">
          <Segmented<string>
            options={['自动', '优先 HF', '优先 ModelScope']}
            value={cfg.download.sourcePref === 'auto' ? '自动' : cfg.download.sourcePref === 'hf' ? '优先 HF' : '优先 ModelScope'}
            aria-label="模型下载源"
            onChange={(v) =>
              save({ download: { sourcePref: v === '自动' ? 'auto' : v === '优先 HF' ? 'hf' : 'modelscope' } })
            }
          />
        </Row>
        <Row title="模型目录" desc="便携布局，随项目文件夹迁移">
          <span className="num text-micro text-ink3 bg-sunken border border-line px-2.5 py-1.5">
            .\models\
          </span>
        </Row>
      </div>

      <GlossaryManager />
      {/* 翻译模式（领域约束模板） */}
      <div className="bg-surface border border-line pb-1.5">
        <div className="px-5 pt-4 pb-2">
          <span className="text-micro uppercase tracking-caps text-ink3">
            翻译模式 · <b className="text-ink2 font-medium">MODES</b>
          </span>
        </div>
        <div className="px-5 pb-3 flex flex-col gap-2.5">
          <p className="text-micro text-ink3">
            模式 = 一组预填的约束模板（硬/软约束 + 文体域），在主翻译台顶栏下拉切换；
            切换后仍可在约束抽屉里微调。内置模板只读，自定义模板在此管理。
          </p>
          {BUILTIN_MODES.map((m) => (
            <div key={m.id} className="flex items-center gap-3 text-caption border-t border-line pt-2.5">
              <b className="text-ink2 font-medium w-44 shrink-0">{m.name}</b>
              <span className="text-ink3 flex-1">{m.description}</span>
              <Button size="sm" onClick={() => setDetailMode(m)}>
                查看
              </Button>
              <Badge>内置</Badge>
            </div>
          ))}
          {customModes.map((m) => (
            <div key={m.id} className="flex items-center gap-3 text-caption border-t border-line pt-2.5">
              <b className="text-ink1 font-medium w-44 shrink-0">{m.name}</b>
              <span className="text-ink3 flex-1 truncate">{m.description}</span>
              <Button size="sm" onClick={() => openEditMode(m)}>
                编辑
              </Button>
              <Button
                size="sm"
                kind="danger"
                onClick={() => {
                  useModeStore.getState().remove(m.id)
                  toast.push({ tone: 'ok', message: `已删除：${m.name}` })
                }}
              >
                删除
              </Button>
            </div>
          ))}
          <div className="pt-2.5 border-t border-line">
            <Button onClick={openNewMode}>
              <Plus size={14} /> 新建自定义模式
            </Button>
          </div>
        </div>
      </div>

      {/* 外观与数据 */}
      <div className="bg-surface border border-line pb-1.5">
        <div className="px-5 pt-4 pb-2">
          <span className="text-micro uppercase tracking-caps text-ink3">
            外观与数据 · <b className="text-ink2 font-medium">APPEARANCE / DATA</b>
          </span>
        </div>
        <Row title="主题" desc="立即生效，重启保持">
          <Segmented<string>
            options={['浅色', '深色', '跟随系统']}
            value={appearanceTheme === 'light' ? '浅色' : appearanceTheme === 'dark' ? '深色' : '跟随系统'}
            aria-label="主题"
            onChange={setThemeMode}
          />
        </Row>
        <Row title="界面字号" desc="立即生效，只缩放正文三级">
          <Segmented<string>
            options={['小', '标准', '大']}
            value={appearanceFontSize === 'small' ? '小' : appearanceFontSize === 'large' ? '大' : '标准'}
            aria-label="界面字号"
            onChange={setFontSize}
          />
        </Row>
        <Row title="历史记录保留" desc="超过上限自动清理最旧记录">
          <input
            aria-label="历史记录保留上限"
            className={numInputCls}
            value={cfg.history.maxEntries}
            onChange={(e) => setCfg({ ...cfg, history: { ...cfg.history, maxEntries: parseInt(e.target.value || '0', 10) || 0 } })}
            onBlur={() => save({ history: cfg.history })}
          />
          <Button kind="ghost" onClick={() => setConfirmClear(true)}>
            立即清空
          </Button>
        </Row>
        <Row title="记录日志" desc="默认关闭，修改后重启应用生效；开启时记录应用和推理引擎日志，运行日志保留 7 天">
          <Switch label="记录日志" srOnly checked={!!cfg.loggingEnabled} onChange={loggingEnabled => save({ loggingEnabled })} />
        </Row>
        <Row title="日志管理" desc="清理已有日志和诊断包；正在使用的文件会跳过，不影响模型和翻译历史">
          <Button onClick={() => apiOpenLogsFolder().catch(() => {})}>打开日志目录</Button>
          <Button
            kind="primary"
            onClick={() =>
              apiCollectLogs()
                .then((p) => {
                  setLogsPath(p)
                  toast.push({ tone: 'ok', message: `日志已打包：${p}` })
                })
                .catch((e) => toast.push({ tone: 'error', message: String((e as { message?: string })?.message ?? e) }))
            }
          >
            一键收集打包
          </Button>
          <Button
            disabled={clearingLogs}
            onClick={async () => {
              if (clearingLogs) return
              setClearingLogs(true)
              try {
                const result = await apiClearLogs()
                setLogsPath('')
                toast.push({ tone: result.skipped.length ? 'warn' : 'ok', message: `已清理 ${result.removed} 个日志或诊断包${result.skipped.length ? `；${result.skipped.length} 个文件未能删除，请关闭占用后重试：${result.skipped.join('、')}` : ''}` })
              } catch (e) {
                toast.push({ tone: 'error', message: String((e as { message?: string })?.message ?? e) })
              } finally {
                setClearingLogs(false)
              }
            }}
          >
            {clearingLogs ? '正在清理…' : '清理日志'}
          </Button>
        </Row>
        {logsPath && (
          <div className="px-5 py-2 border-t border-line text-caption text-ok">
            已打包: {logsPath}
          </div>
        )}
        <Row title="隐私" desc="全本地推理 · 零遥测 · 除模型下载外零网络请求">
          <Badge tone="ok" dot>
            离线可用
          </Badge>
        </Row>
      </div>

      {/* 关于 */}
      <div className="bg-surface border border-line pb-3.5">
        <div className="px-5 pt-4 pb-2">
          <span className="text-micro uppercase tracking-caps text-ink3">
            关于 · <b className="text-ink2 font-medium">ABOUT</b>
          </span>
        </div>
        <div className="px-5 pt-1 text-body font-medium text-ink2 leading-relaxed space-y-1 select-text">
          <p>Index-VT v{cfg.version ?? '1.0.0'} · Wails v2 / Go / React 18</p>
          <p>模型权重 Apache-2.0 © Bilibili IndexTeam · llama.cpp MIT</p>
          <p>本软件与 bilibili / IndexTeam 无官方关联；模型输出由 Apache-2.0 开源权重本地推理产生。</p>
        </div>
      </div>
      {saved && (
        <div className="fixed bottom-14 right-6">
          <Badge tone="ok" dot>
            已保存
          </Badge>
        </div>
      )}

      {/* 清空历史确认（破坏性：初始焦点在取消） */}
      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="清空全部历史记录"
        initialFocus="cancel"
        footer={
          <>
            <Button data-modal-initial="cancel" onClick={() => setConfirmClear(false)}>
              取消
            </Button>
            <Button
              kind="danger"
              data-modal-initial="confirm"
              onClick={() => {
                apiClearHistory()
                  .then(() => toast.push({ tone: 'ok', message: '历史记录已清空' }))
                  .catch((e) => toast.push({ tone: 'error', message: String((e as { message?: string })?.message ?? e) }))
                setConfirmClear(false)
              }}
            >
              清空
            </Button>
          </>
        }
      >
        <p className="text-body text-ink2">将删除全部翻译历史（含收藏标记），此操作不可恢复。</p>
      </Modal>

      {/* 自定义模式编辑器（预留接口的配置面） */}
      <Modal
        open={modeEditor !== null}
        onClose={() => setModeEditor(null)}
        title={modeEditor?.id ? '编辑自定义模式' : '新建自定义模式'}
        footer={
          <>
            <Button data-modal-initial="cancel" onClick={() => setModeEditor(null)}>
              取消
            </Button>
            <Button kind="primary" data-modal-initial="confirm" onClick={saveMode}>
              保存
            </Button>
          </>
        }
      >
        {modeEditor && (
          <div className="flex flex-col gap-4">
            <Field
              label="模式名称（必填）"
              value={modeEditor.name}
              onChange={(e) => setModeEditor({ ...modeEditor, name: e.target.value })}
              placeholder="例如：游戏本地化"
            />
            <Field
              label="一句话说明（下拉悬停提示）"
              value={modeEditor.description}
              onChange={(e) => setModeEditor({ ...modeEditor, description: e.target.value })}
              placeholder="描述该模式的适用场景"
            />
            <Textarea
              label="硬约束（每行一条，译文必须遵守）"
              rows={4}
              value={modeEditor.hard}
              onChange={(e) => setModeEditor({ ...modeEditor, hard: e.target.value })}
              placeholder="例如：术语首次出现括注原文"
            />
            <Textarea
              label="软约束（每行一条，风格倾向）"
              rows={4}
              value={modeEditor.soft}
              onChange={(e) => setModeEditor({ ...modeEditor, soft: e.target.value })}
              placeholder="例如：句式简洁"
            />
            <Field
              label="文体域"
              value={modeEditor.genre}
              onChange={(e) => setModeEditor({ ...modeEditor, genre: e.target.value })}
              placeholder="文本"
            />
            <Switch
              checked={modeEditor.jsonPreserve}
              onChange={(v) => setModeEditor({ ...modeEditor, jsonPreserve: v })}
              label="JSON 保序（输入为 JSON dict 时保留键结构）"
            />
          </div>
        )}
      </Modal>

      {/* ctx 自定义档：显存可能不足时的二次确认（破坏性，初始焦点在取消） */}
      <Modal
        open={pendingCtxTok !== null}
        onClose={() => setPendingCtxTok(null)}
        title="显存可能不足"
        initialFocus="cancel"
        footer={
          <>
            <Button data-modal-initial="cancel" onClick={() => setPendingCtxTok(null)}>
              取消
            </Button>
            <Button
              kind="danger"
              data-modal-initial="confirm"
              onClick={() => {
                if (pendingCtxTok !== null) {
                  save({ inference: { ...cfg.inference, ctxTokensOverride: pendingCtxTok } })
                }
                setPendingCtxTok(null)
              }}
            >
              仍要使用
            </Button>
          </>
        }
      >
        <p className="text-body text-ink2">
          上下文 {pendingCtxTok ? pendingCtxTok / 1024 : 0}K 预计占用{' '}
          {((ctxEst?.totalMiB ?? 0) / 1024).toFixed(1)} GB，超过当前可用显存{' '}
          {((ctxEst?.gpu?.freeMB ?? 0) / 1024).toFixed(1)} GB。以上为估算值（±20%），
          继续可能触发显存不足导致模型加载失败；失败后可回设置页调回小档位。
        </p>
      </Modal>

      <ModeDetails preset={detailMode} open={detailMode !== null} onClose={() => setDetailMode(null)} />
    </div>
  )
}
