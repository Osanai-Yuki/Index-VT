import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Field, Modal, Textarea } from './ui/index'
import { apiDeleteGlossary, apiListGlossaries, apiSaveGlossary, apiSaveGlossaryCSV, apiRevealFile } from '../wailsapi'
import { toast } from '../stores/toastStore'
import { glossaryCSV, parseGlossary, validateEntries, type Glossary, type GlossaryEntry } from '../lib/glossary'

const errorToast = (error: unknown) => { toast.push({ tone: 'error', message: String(error) }) }

export function GlossaryManager() {
  const [books, setBooks] = useState<Glossary[]>([])
  const [draft, setDraft] = useState<{ id: number; name: string; text: string } | null>(null)
  const [imported, setImported] = useState<GlossaryEntry[] | null>(null)
  const [strategy, setStrategy] = useState<'replace' | 'merge'>('merge')
  const [deleting, setDeleting] = useState<Glossary | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = () => apiListGlossaries().then(gs => setBooks(gs ?? []))
  useEffect(() => { refresh().catch(errorToast) }, [])
  const parsed = useMemo(() => {
    try { const items = parseGlossary(draft?.text ?? ''); validateEntries(items); return { items, error: '' } }
    catch (error) { return { items: [] as GlossaryEntry[], error: String(error) } }
  }, [draft?.text])

  const save = async () => {
    if (!draft || busy || parsed.error) return
    const previous = books.find(b => b.id === draft.id)
    setBusy(true)
    try {
      const id = await apiSaveGlossary({ id: draft.id, name: draft.name.trim(), items: parsed.items })
      setDraft(null); setImported(null)
      await refresh()
      toast.push({ tone: 'ok', message: '术语本已保存', action: { label: '撤销本次保存', run: () => {
        apiListGlossaries().then(async current => {
          const saved = current.find(g => g.id === id)
          if (!saved || saved.name !== draft.name.trim() || JSON.stringify(saved.items) !== JSON.stringify(parsed.items)) throw new Error('术语本已再次修改，不能撤销旧的保存；请打开编辑检查。')
          if (previous) await apiSaveGlossary(previous)
          else await apiDeleteGlossary(id)
        }).then(() => refresh()).catch(errorToast)
      } } })
    } catch (error) { errorToast(error) }
    finally { setBusy(false) }
  }

  return (
    <section className="bg-surface border border-line p-5" aria-label="术语本管理">
      <div className="flex items-center gap-3"><h2 className="text-title">术语本</h2><Button onClick={() => { setImported(null); setDraft({ id: 0, name: '', text: 'term,translation\n王妃,Queen' }) }}>新建术语本</Button></div>
      <p className="text-caption text-ink2 mt-2">词条用于模型提示，不做机械替换。按原样区分大小写，不自动匹配复数、变体或词边界；短词可能命中长词的一部分。请结合上下文试译。</p>
      <p className="text-caption text-ink2 mt-1">主翻译、配音、文档与字幕可选择术语本。保存不会修改已开始任务的参数。源文未出现的词条不参与命中统计。</p>
      {books.length === 0 && <p className="text-body text-ink2 mt-3">还没有术语本，可新建后输入词条或导入CSV/TSV。</p>}
      {books.map(book => <div key={book.id} className="flex items-center gap-3 border-t border-line mt-3 pt-3">
        <span className="text-body flex-1 min-w-0 break-words">{book.name}</span><Badge>{book.items?.length ?? 0} 条</Badge>
        <Button onClick={() => { setImported(null); setDraft({ id: book.id, name: book.name, text: glossaryCSV(book.items ?? []) }) }}>编辑</Button>
        <Button onClick={() => apiSaveGlossaryCSV(book.id).then(path => { if (path) toast.push({ tone: 'ok', message: `已导出：${path}`, action: { label: '打开所在文件夹', run: () => { apiRevealFile(path).catch(errorToast) } } }) }).catch(errorToast)}>导出 CSV</Button>
        <Button kind="danger" onClick={() => setDeleting(book)}>删除</Button>
      </div>)}
      <Modal open={draft !== null} onClose={() => { if (!busy) { setDraft(null); setImported(null) } }} title="编辑术语本" footer={<><Button data-modal-initial="cancel" disabled={busy} onClick={() => { setDraft(null); setImported(null) }}>取消</Button><Button kind="primary" disabled={busy || !draft?.name.trim() || !!parsed.error} onClick={save}>{busy ? '正在保存…' : '保存术语本'}</Button></>}>
        <Field label="术语本名称" value={draft?.name ?? ''} maxLength={100} onChange={e => setDraft(d => d && ({ ...d, name: e.target.value }))} />
        <Textarea className="mt-3" label="词条 CSV（原词、译名）" rows={7} value={draft?.text ?? ''} onChange={e => setDraft(d => d && ({ ...d, text: e.target.value }))} />
        <p className="text-caption text-ink2 mt-1">两列：term,translation。支持带引号的逗号和换行。导入只进入草稿，保存后才生效。</p>
        {parsed.error ? <p role="alert" className="text-danger text-caption">{parsed.error}</p> : <p className="text-caption text-ink2">预览：{parsed.items.length}条；前3条：{parsed.items.slice(0, 3).map(i => `${i.term} → ${i.translation}`).join('；')}</p>}
        <label className="mt-3 block text-body">导入 CSV / TSV<input type="file" accept=".csv,.tsv,.txt" className="mt-1 block w-full" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''
          if (!file) return
          try { if (file.size > 1024 * 1024) throw new Error('导入上限1MiB'); const items = parseGlossary(await file.text()); validateEntries(items); setImported(items) } catch (error) { errorToast(error) }
        }} /></label>
        {imported && <div className="mt-3 border border-line p-3">
          <p className="text-caption">待导入{imported.length}条，前3条：{imported.slice(0, 3).map(i => `${i.term} → ${i.translation}`).join('；')}</p>
          <label className="text-body">导入策略<select aria-label="术语导入策略" className="bg-sunken border border-line p-2 ml-2" value={strategy} onChange={e => setStrategy(e.target.value as 'replace' | 'merge')}><option value="merge">追加并检查重复</option><option value="replace">替换全部草稿词条</option></select></label>
          <Button className="mt-2" onClick={() => {
            try { const items = strategy === 'replace' ? imported : [...parsed.items, ...imported]; if (strategy === 'merge' && parsed.error) throw new Error('先修正当前草稿'); validateEntries(items); setDraft(d => d && ({ ...d, text: glossaryCSV(items) })); setImported(null) } catch (error) { errorToast(error) }
          }}>采用导入内容</Button>
        </div>}
      </Modal>
      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="删除术语本？" footer={<><Button data-modal-initial="cancel" onClick={() => setDeleting(null)}>取消</Button><Button kind="danger" onClick={async () => { if (!deleting || busy) return; setBusy(true); const book = deleting; try { await apiDeleteGlossary(book.id); setDeleting(null); await refresh(); toast.push({ tone: 'ok', message: '术语本已删除', action: { label: '恢复', run: () => { apiSaveGlossary({ ...book, id: 0 }).then(() => refresh()).catch(errorToast) } } }) } catch (error) { errorToast(error) } finally { setBusy(false) } }} disabled={busy}>确认删除</Button></>}>
        删除“{deleting?.name}”不会修改已有译文。恢复会创建新的术语本，需要重新选择。
      </Modal>
    </section>
  )
}
