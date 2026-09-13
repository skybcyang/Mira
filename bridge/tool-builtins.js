import { jsonBytes, toolError } from '../src/domain/toolPolicy.js'
const failed = message => { throw toolError('TOOL_FAILED', message) }
function csvRows(text) {
  const rows = []; let row = [], field = '', quoted = false, closed = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') { quoted = false; closed = true }
      else field += c
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false
      if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++ }
    } else if (c === '"' && !field && !closed) quoted = true
    else { if (closed || c === '"') failed('CSV 引号或分隔结构无效。'); field += c }
    if (rows.length > 10000 || row.length > 100) failed('CSV 超过 10000 行或 100 列。')
  }
  if (quoted) failed('CSV 存在未闭合引号。')
  if (field || row.length || closed) rows.push([...row, field])
  if (rows.length > 10000 || rows.some(r => r.length > 100)) failed('CSV 超过 10000 行或 100 列。')
  if (rows.length < 2 || rows.some(r => r.length !== rows[0].length)) failed('CSV 需要表头和宽度一致的数据行。')
  return rows
}
export async function executeBuiltin(id, args, input, { urls = [], web, signal } = {}) {
  let result
  if (id === 'mira-source-search') {
    if (!args.query?.trim()) failed('请输入检索词。')
    result = []; let inputBytes = 0, resultBytes = 2
    const query = args.query.toLowerCase()
    for (const [sourceIndex, source] of (input.sources || []).entries()) {
      if (typeof source.text !== 'string' || source.text.length > 2097152 || (inputBytes += new TextEncoder().encode(source.text).length) > 2097152) throw toolError('TOOL_LIMIT', '材料检索最多接收 2 MiB 冻结文本。')
      for (const [index, text] of source.text.split(/\r?\n/).entries()) if (text.toLowerCase().includes(query)) {
        const match = { sourceIndex, line: index + 1, text }
        if ((resultBytes += jsonBytes(match) + 1) > 65536) throw toolError('TOOL_LIMIT', '检索结果超过 64 KiB，请缩小检索词或来源范围。')
        result.push(match)
      }
    }
  } else if (id === 'mira-calculator') {
    const v = args.values
    if (!Array.isArray(v) || !v.length || v.some(x => !Number.isFinite(x))) failed('请提供有限数字。')
    const operations = { sum: () => v.reduce((a, b) => a + b, 0), subtract: () => v.slice(1).reduce((a, b) => a - b, v[0]), multiply: () => v.reduce((a, b) => a * b, 1), divide: () => v.slice(1).reduce((a, b) => a / b, v[0]), mean: () => v.reduce((a, b) => a + b, 0) / v.length, percent: () => v.length === 2 ? v[0] / v[1] * 100 : NaN }
    const value = operations[args.operation]?.()
    if (!Number.isFinite(value)) failed('运算不可用、除数为零或结果超出有限范围。')
    result = { value, arithmetic: 'IEEE-754 double precision' }
  } else if (id === 'mira-csv-summary') {
    const source = input.sources?.[args.sourceIndex]
    if (!source || source.text.length > 1000000 || new TextEncoder().encode(source.text).length > 1000000) failed('所选冻结来源不存在或 CSV 超过 1 MB。')
    const [header, ...rows] = csvRows(source.text.replace(/^\uFEFF/, ''))
    result = { rows: rows.length, columns: header.map((name, i) => {
      const values = rows.map(row => row[i].trim()), nonempty = values.filter(Boolean)
      const numeric = nonempty.length > 0 && nonempty.every(v => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v) && Number.isFinite(Number(v)))
      const numbers = numeric ? nonempty.map(Number) : []
      const sum = numbers.reduce((a, b) => a + b, 0)
      if (!Number.isFinite(sum)) failed('数值列总计超出有限范围。')
      return { name, missing: values.length - nonempty.length, ...(numeric ? { min: Math.min(...numbers), max: Math.max(...numbers), sum, mean: sum / numbers.length } : {}) }
    }) }
  } else if (id === 'mira-output-check') {
    const characters = Array.from(input.output || '').length, missing = (args.contains || []).filter(part => !(input.output || '').includes(part))
    result = { characters, missing, passed: (!args.maxCharacters || characters <= args.maxCharacters) && missing.length === 0 }
  } else if (id === 'mira-web-read') {
    if (!urls.includes(args.url)) throw toolError('TOOL_POLICY_INVALID', '该 URL 不在本步允许范围内。')
    if (!web) throw toolError('TOOL_UNAVAILABLE', '此宿主未提供网页读取。')
    const page = await web({ url: args.url }, { signal, allowedUrls: urls })
    result = { url: page.url || args.url, text: page.text, warnings: page.warnings }
  } else throw toolError('TOOL_UNAVAILABLE', '内置工具不存在。')
  return { text: JSON.stringify(result) }
}
