import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
const server = new Server({ name: 'mira-test-stdio', version: '1' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'environment', inputSchema: { type: 'object' } }] }))
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name === 'disconnect') process.exit(0)
  if (request.params.name === 'large') { process.stdout.write('x'.repeat(1024 * 1024 + 1)); return new Promise(() => {}) }
  if (request.params.name === 'wait') return new Promise(() => {})
  return { content: [{ type: 'text', text: JSON.stringify({ pid: process.pid, explicit: process.env.EXPLICIT_VALUE, secret: process.env.MIRA_TEST_HOST_SECRET, home: process.env.HOME }) }] }
})
await server.connect(new StdioServerTransport())
