export interface GlossaryEntry { term: string; translation: string }
export interface Glossary { id: number; name: string; items: GlossaryEntry[] }

export function parseGlossary(text: string): GlossaryEntry[] {
  if (text.length > 1024 * 1024) throw new Error('导入上限1MiB，请拆分文件')
  text = text.replace(/^\uFEFF/, '')
  const delimiter = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false, closed = false
  const pushCell = () => { row.push(cell.trim()); cell = ''; closed = false }
  const pushRow = () => { pushCell(); if (row.some(Boolean)) rows.push(row); row = [] }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') { quoted = false; closed = true }
      else cell += c
    } else if (c === '"') {
      if (cell.trim() || closed) throw new Error(`第${rows.length + 1}行引号位置错误`)
      quoted = true
    } else if (c === delimiter) pushCell()
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow() }
    else { if (closed && c.trim()) throw new Error(`第${rows.length + 1}行引号后有多余内容`); cell += c }
  }
  if (quoted) throw new Error('CSV引号未闭合')
  if (cell || row.length) pushRow()
  if (rows[0]?.map(s => s.toLowerCase()).join(',') === 'term,translation' || rows[0]?.join(',') === '原词,译名') rows.shift()
  if (rows.length > 5000) throw new Error('术语本上限5000条')
  return rows.map((r, i) => {
    if (r.length !== 2 || !r[0] || !r[1]) throw new Error(`第${i + 1}条需要两列非空的原词、译名`)
    return { term: r[0], translation: r[1] }
  })
}

export function validateEntries(items: GlossaryEntry[]) {
  const seen = new Map<string, number>()
  items.forEach((item, i) => {
    const key = item.term.trim().toLowerCase()
    if (!key || !item.translation.trim()) throw new Error(`第${i + 1}条原词或译名为空`)
    if (seen.has(key)) throw new Error(`第${i + 1}条与第${seen.get(key)}条重复或存在大小写冲突`)
    seen.set(key, i + 1)
  })
}

export function glossaryCSV(items: GlossaryEntry[]) {
  const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"'
  return 'term,translation\n' + items.map(it => `${quote(it.term)},${quote(it.translation)}`).join('\n')
}
