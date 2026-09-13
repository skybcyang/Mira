import { useId, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseExtractionList } from '../domain/extraction.js'

const remarkPlugins = [remarkGfm]
const table: Components['table'] = ({ children }) => <div className="v2-markdown-table nodrag nowheel" role="region" aria-label="表格" tabIndex={0}><table>{children}</table></div>

export default function MarkdownContent({ children }: { children: string }) {
  const readable = useMemo(() => {
    try {
      const items = parseExtractionList(children)
      return items === null ? children : items.map(item => `## ${item.title}\n\n${item.markdown}`).join('\n\n') || '没有符合要求的条目。'
    } catch { return children }
  }, [children])
  const prefix = `mira-${useId()}-`
  const footnoteLabelId = `${prefix}footnote-label`
  const components = useMemo<Components>(() => ({
    table,
    h2: ({ node: _node, ...props }) => <h2 {...props} id={props.id === 'footnote-label' ? footnoteLabelId : props.id} />,
    a: ({ node: _node, ...props }) => <a {...props} aria-describedby={props['aria-describedby'] === 'footnote-label' ? footnoteLabelId : props['aria-describedby']} />,
  }), [footnoteLabelId])
  return <div className="v2-markdown"><ReactMarkdown
    remarkPlugins={remarkPlugins}
    remarkRehypeOptions={{ clobberPrefix: prefix, footnoteLabel: '注释', footnoteBackLabel: '返回正文' }}
    components={components}
  >{readable}</ReactMarkdown></div>
}
