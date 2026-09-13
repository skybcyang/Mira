import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createPythonRunner } from '../bridge/node-python-runner.js';

// No download by default. --prepare is an explicit environment setup operation.
const ownerId = randomUUID();
const ownerFilter = `label=app.mira.python.owner=${ownerId}`;
const runner = createPythonRunner({ ownerId });
const image = process.env.MIRA_PYTHON_IMAGE || 'python:3.13-slim';
const withDependencies = process.argv.includes('--prepare-dependencies');
const status = withDependencies || process.argv.includes('--prepare') ? await runner.prepare({ image, ...(withDependencies ? { dependencies: ['packaging==24.2'] } : {}) }) : await runner.status({ image });
assert.equal(status.available, true, status.reason);
const imageId = status.imageId;
const input = { sources: [{ text: 'only the selected fragment' }], arguments: { count: 7 } };
const execute = (code, options = {}, context) => runner.execute({ code, input, imageId, ...options }, context);
if (withDependencies) assert.deepEqual(await execute('import packaging\nprint(packaging.__version__)'), { text: '24.2\n' });
assert.deepEqual(await execute('print(42)'), { text: '42\n' });
assert.deepEqual(await execute('import json,sys\nv=json.load(sys.stdin)\nprint(v["sources"][0]["text"] + ":" + str(v["arguments"]["count"]))'), { text: 'only the selected fragment:7\n' });
const files = await execute('import json,base64\nprint(json.dumps({"text":"chart data", "files":[{"name":"result.csv","mimeType":"text/csv","data":base64.b64encode(b"a,b\\n1,2").decode()}]}))');
assert.equal(files.files[0].data, Buffer.from('a,b\n1,2').toString('base64'));
await assert.rejects(execute('print("x" * 65537)'), { code: 'TOOL_LIMIT' });
await assert.rejects(execute('import json\nprint(json.dumps({"text":"x","files":[{"name":"../escape.txt","mimeType":"text/plain","data":"eA=="}]}))'), { code: 'TOOL_FAILED' });
await assert.rejects(execute('import sys\nsys.stderr.write("x" * 1048577)'), { code: 'TOOL_LIMIT' });
await assert.rejects(execute('import time\ntime.sleep(30)', { timeoutMs: 200 }), { code: 'TOOL_TIMEOUT' });
const controller = new AbortController();
const pending = execute('import time\ntime.sleep(30)', {}, { signal: controller.signal });
setTimeout(() => controller.abort(), 2000);
await assert.rejects(pending, { name: 'AbortError' });
// The container's wall-time limit must survive abrupt loss of the Node Host.
const childCode = `import {createPythonRunner} from './bridge/node-python-runner.js'; await createPythonRunner(${JSON.stringify({ ownerId })}).execute(${JSON.stringify({ code: 'import signal,time\nsignal.alarm(0)\ntime.sleep(30)', input, imageId, timeoutMs: 1500 })});`;
const host = spawn(process.execPath, ['--input-type=module', '-e', childCode], { stdio: 'ignore' });
await delay(800);
const owned = execFileSync('docker', ['ps', '-q', '--filter', ownerFilter], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
assert.ok(owned.length, 'host-crash test must observe an active container');
host.kill('SIGKILL');
try {
  await delay(2200);
  for (const id of owned) {
    const running = execFileSync('docker', ['inspect', '--format', '{{.State.Running}}', id], { encoding: 'utf8' }).trim();
    assert.equal(running, 'false', 'container must enforce timeout after Host death');
  }
} finally {
  for (const id of owned) {
    const container = JSON.parse(execFileSync('docker', ['inspect', id], { encoding: 'utf8' }))[0];
    assert.equal(container.Config.Labels['app.mira.python.owner'], ownerId);
    execFileSync('docker', ['rm', '--force', container.Id], { stdio: 'ignore' });
  }
}
const remaining = execFileSync('docker', ['ps', '-aq', '--filter', ownerFilter], { encoding: 'utf8' }).trim();
assert.equal(remaining, '', 'owned containers must be removed after timeout and cancellation');
console.log(JSON.stringify({ passed: true, imageId, runtime: status.runtime, checks: ['real isolation probes', 'stdin scope', 'text and attachments', 'byte limits', 'path rejection', 'timeout cleanup', 'abort cleanup', 'Host-crash wall-time limit'] }));
