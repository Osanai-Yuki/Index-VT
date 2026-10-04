// 设置页（01 文档 §6.4 / mockups 屏 5）：推理 / 资源 / 下载 / 外观与数据 / 关于。
import { useEffect, useState } from 'react'
import { Chip, Btn, Seg, Switch, Field } from '../components/ui'
import { apiGetConfig, apiSetConfig, apiCollectLogs, apiClearHistory, apiOpenLogsFolder } from '../wailsapi'

export function SettingsPage() {
  const [cfg, setCfg] = useState<any>(null)
  const [saved, setSaved] = useState(false)
  const [logsPath, setLogsPath] = useState('')

  useEffect(() => {
    apiGetConfig().then(setCfg).catch(() => {})
  }, [])

  const save = (patch: any) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    apiSetConfig(next).then(() => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }).catch((e) => alert(e))
  }

  if (!cfg) return <div className="text-ink-3 text-sm">加载配置…</div>

  const Row = ({ title, desc, children }: { title: string; desc?: string; children: any }) => (
    <div className="flex items-center gap-4 px-5 py-3 border-t border-hairline">
      <div>
        <div className="text-[13.5px] font-semibold">{title}</div>
        {desc && <div className="text-[11.5px] text-ink-3 mt-0.5">{desc}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2.5">{children}</div>
    </div>
  )

  return (
    <div className="max-w-[960px] mx-auto flex flex-col gap-4 overflow-auto h-full screen-in pb-6">
      {/* 推理 */}
      <div className="bg-bg-1 border border-hairline rounded-[14px] pb-1.5">
        <div className="px-5 pt-4 pb-2">
          <span className="label">
            推理 · <b>INFERENCE</b>
          </span>
        </div>
        <Row title="GPU 层数卸载（-ngl）" desc="0 = 纯 CPU；99 = 全部层上卡；-1 = 自动">
          <input
            className="bg-bg-3 border border-hairline rounded-lg text-ink-1 text-center font-mono w-[88px] py-1.5 outline-none focus:border-accent-line"
            value={cfg.inference.nglOverride}
            onChange={(e) => setCfg({ ...cfg, inference: { ...cfg.inference, nglOverride: parseInt(e.target.value || '0', 10) || 0 } })}
            onBlur={() => save({ inference: cfg.inference })}
          />
          <Btn kind="ghost" onClick={() => save({ inference: { ...cfg.inference, nglOverride: -1 } })}>
            恢复默认
          </Btn>
        </Row>
        <Row title="上下文档位" desc="影响 KV cache 显存占用">
          <Seg
            options={['8K', '16K', '32K']}
            value={cfg.inference.ctxTier}
            accentSel
            onChange={(v) => save({ inference: { ...cfg.inference, ctxTier: v } })}
          />
        </Row>
        <Row title="CPU 线程数" desc="CPU 推理与 KV 分层时生效；0 = 自动">
          <input
            className="bg-bg-3 border border-hairline rounded-lg text-ink-1 text-center font-mono w-[88px] py-1.5 outline-none focus:border-accent-line"
            value={cfg.inference.cpuThreads}
            onChange={(e) => setCfg({ ...cfg, inference: { ...cfg.inference, cpuThreads: parseInt(e.target.value || '0', 10) || 0 } })}
            onBlur={() => save({ inference: cfg.inference })}
          />
        </Row>
        <Row title="温度覆盖（高级）" desc="三模型默认参数已最优：Translate/Nailong 0 · Homura 0.3">
          <Switch on={cfg.inference.tempOverride} onChange={(v) => save({ inference: { ...cfg.inference, tempOverride: v } })} />
        </Row>
      </div>

      {/* 资源 */}
      <div className="bg-bg-1 border border-hairline rounded-[14px] pb-1.5">
        <div className="px-5 pt-4 pb-2">
          <span className="label">
            资源 · <b>RESOURCES</b>
          </span>
        </div>
        <Row title="空闲自动释放" desc="无任务持续超时后卸载模型，释放显存">
          <input
            type="range"
            min={1}
            max={30}
            value={Math.max(1, cfg.resource.idleUnloadMinutes || 1)}
            onChange={(e) => setCfg({ ...cfg, resource: { ...cfg.resource, idleUnloadMinutes: parseInt(e.target.value, 10) } })}
            onMouseUp={() => save({ resource: cfg.resource })}
            className="w-[160px] accent-[var(--accent)]"
          />
          <Chip tone="amber">{cfg.resource.idleUnloadMinutes === 0 ? '常驻' : `${cfg.resource.idleUnloadMinutes} 分钟`}</Chip>
          <Switch
            on={(cfg.resource.idleUnloadMinutes ?? 5) > 0}
            onChange={(v) => save({ resource: { ...cfg.resource, idleUnloadMinutes: v ? 5 : 0 } })}
          />
        </Row>
        <Row title="关闭程序时" desc="退出即释放全部资源（推荐）">
          <Seg options={['退出即释放']} value="退出即释放" accentSel />
        </Row>
      </div>

      {/* 下载 */}
      <div className="bg-bg-1 border border-hairline rounded-[14px] pb-1.5">
        <div className="px-5 pt-4 pb-2">
          <span className="label">
            下载 · <b>DOWNLOAD</b>
          </span>
        </div>
        <Row title="模型下载源" desc="自动探测按连通性与延迟择优">
          <Seg
            options={['自动', '优先 HF', '优先 ModelScope']}
            value={cfg.download.sourcePref === 'auto' ? '自动' : cfg.download.sourcePref === 'hf' ? '优先 HF' : '优先 ModelScope'}
            accentSel
            onChange={(v) =>
              save({ download: { sourcePref: v === '自动' ? 'auto' : v === '优先 HF' ? 'hf' : 'modelscope' } })
            }
          />
        </Row>
        <Row title="模型目录" desc="便携布局，随项目文件夹迁移">
          <span className="font-mono text-[11px] text-ink-3 bg-bg-2 border border-hairline rounded-lg px-2.5 py-1.5">
            .\models\
          </span>
        </Row>
      </div>

      {/* 外观与数据 */}
      <div className="bg-bg-1 border border-hairline rounded-[14px] pb-1.5">
        <div className="px-5 pt-4 pb-2">
          <span className="label">
            外观与数据 · <b>APPEARANCE / DATA</b>
          </span>
        </div>
        <Row title="主题">
          <Seg options={['暗色']} value="暗色" accentSel />
        </Row>
        <Row title="界面字号">
          <Seg options={['小', '标准', '大']} value="标准" accentSel />
        </Row>
        <Row title="历史记录保留" desc="超过上限自动清理最旧记录">
          <Field
            className="font-mono text-center w-[88px]"
            value={cfg.history.maxEntries}
            onChange={(e) => setCfg({ ...cfg, history: { ...cfg.history, maxEntries: parseInt(e.target.value || '0', 10) || 0 } })}
            onBlur={() => save({ history: cfg.history })}
          />
          <Btn kind="ghost" onClick={() => { if (confirm('清空全部历史记录？')) apiClearHistory().catch(() => {}) }}>
            立即清空
          </Btn>
        </Row>
        <Row title="日志" desc="logs\indexvt-YYYYMMDD.log · 滚动保留 7 天">
          <Btn onClick={() => apiOpenLogsFolder().catch(() => {})}>打开日志目录</Btn>
          <Btn kind="primary" onClick={() => apiCollectLogs().then((p) => setLogsPath(p)).catch((e) => alert(e))}>
            一键收集打包
          </Btn>
        </Row>
        {logsPath && (
          <div className="px-5 py-2 border-t border-hairline text-xs text-teal font-mono">已打包: {logsPath}</div>
        )}
        <Row title="隐私" desc="全本地推理 · 零遥测 · 除模型下载外零网络请求">
          <Chip tone="on" dot>
            离线可用
          </Chip>
        </Row>
      </div>

      {/* 关于 */}
      <div className="bg-bg-1 border border-hairline rounded-[14px] pb-3.5">
        <div className="px-5 pt-4 pb-2">
          <span className="label">
            关于 · <b>ABOUT</b>
          </span>
        </div>
        <div className="px-5 pt-1 text-xs text-ink-3 leading-loose">
          Index-VT v{cfg.version ?? '1.0.0'} · Wails v2 / Go / React 18 · 模型权重 Apache-2.0 © Bilibili IndexTeam · llama.cpp MIT
          <br />
          本软件与 bilibili / IndexTeam 无官方关联；模型输出由 Apache-2.0 开源权重本地推理产生。
        </div>
      </div>
      {saved && <div className="fixed bottom-14 right-6 Chip text-teal">已保存</div>}
    </div>
  )
}
