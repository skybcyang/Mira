import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const IMAGE_REF = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/;
const DEPENDENCY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}==[0-9][a-zA-Z0-9.!+_-]{0,63}$/;
const LABEL = 'app.mira.python';
const MIB = 1024 * 1024;
const failure = (code, message) => Object.assign(new Error(message), { code });
const aborted = () => Object.assign(new Error('Python execution cancelled'), { name: 'AbortError' });
const assertActive = (signal) => { if (signal?.aborted) throw aborted(); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));

// The bootstrap travels as a fixed -c argument; user code and material travel only over stdin.
// -I excludes cwd and user-site packages. Dependencies are installed only by explicit prepare.
const BOOTSTRAP = `import io,json,sys
payload=json.load(sys.stdin)
sys.stdin=io.StringIO(json.dumps(payload["input"],ensure_ascii=False))
sys.path.append("/opt/mira-deps")
exec(compile(payload["code"],"<mira-script>","exec"),{"__name__":"__main__"})
`;

// PID 1 stays outside user code. Its wall-time deadline survives Host death and
// cannot be removed by changing signal handlers or cancelling an alarm in the script.
const SUPERVISOR = `import json,signal,subprocess,sys
for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):
    signal.signal(sig,signal.SIG_IGN)
payload=json.load(sys.stdin)
child=subprocess.Popen([sys.executable,"-I","-u","-c",${JSON.stringify(BOOTSTRAP)}],stdin=subprocess.PIPE)
try:
    child.communicate(json.dumps(payload,ensure_ascii=False).encode(),timeout=payload["timeoutMs"]/1000)
except subprocess.TimeoutExpired:
    child.kill()
    sys.exit(124)
sys.exit(child.returncode)
`;

const PROBE = `import errno,json,os,socket,sys
p=json.load(sys.stdin)["arguments"]["sentinel"]
assert not os.path.exists(p), "host-file-visible"
assert os.geteuid()!=0, "root-user"
status=dict(line.split(":",1) for line in open("/proc/self/status") if ":" in line)
assert int(status["CapEff"].strip(),16)==0, "capabilities"
assert status["NoNewPrivs"].strip()=="1", "new-privileges"
assert any(line.split()[1]=="/" and "ro" in line.split()[3].split(",") for line in open("/proc/mounts")), "root-not-readonly"
try:
    open("/mira-isolation-probe","w").close()
except OSError as e:
    assert e.errno in (errno.EROFS,errno.EACCES), "root-write-error"
else:
    raise AssertionError("root-write-allowed")
assert set(os.listdir("/sys/class/net"))=={"lo"}, "network-interface"
s=socket.socket();s.settimeout(0.3)
try:
    s.connect(("1.1.1.1",443))
except OSError:
    pass
else:
    raise AssertionError("network-connected")
finally:
    s.close()
assert not os.path.exists("/var/run/docker.sock"), "docker-socket"
v=os.statvfs("/tmp")
assert 0<v.f_blocks*v.f_frsize<=16*1024*1024, "tmp-limit"
if os.path.exists("/sys/fs/cgroup/memory.max"):
    assert int(open("/sys/fs/cgroup/memory.max").read())<=512*1024*1024, "memory-limit"
    assert int(open("/sys/fs/cgroup/pids.max").read())<=32, "pids-limit"
    quota,period=map(int,open("/sys/fs/cgroup/cpu.max").read().split())
else:
    assert int(open("/sys/fs/cgroup/memory/memory.limit_in_bytes").read())<=512*1024*1024, "memory-limit"
    assert int(open("/sys/fs/cgroup/pids/pids.max").read())<=32, "pids-limit"
    quota=int(open("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read())
    period=int(open("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read())
assert 0<quota<=period, "cpu-limit"
print(json.dumps({"isolated":True,"python":sys.version.split()[0]}))
`;

function validateExecution({ code, input, imageId, timeoutMs = 30000 } = {}) {
  if (!IMAGE_ID.test(imageId) || typeof code !== 'string' || !code.trim() || code.includes('\0') || Buffer.byteLength(code) > 65536
    || !exact(input, ['sources', 'arguments', 'output']) || !Array.isArray(input.sources) || input.sources.length > 100
    || !input.sources.every((source) => exact(source, ['text']) && typeof source.text === 'string')
    || !object(input.arguments) || (input.output !== undefined && typeof input.output !== 'string')
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw failure('TOOL_POLICY_INVALID', 'Python requires reviewed code, frozen text input and an immutable image ID');
  }
  let payload;
  try { payload = JSON.stringify({ code, input, timeoutMs }); } catch { throw failure('TOOL_POLICY_INVALID', 'Python input must be JSON'); }
  if (Buffer.byteLength(payload) > 2 * MIB || Buffer.byteLength(JSON.stringify(input.arguments)) > 32768) {
    throw failure('TOOL_LIMIT', 'Python input exceeds its byte limit');
  }
  return { payload, timeoutMs };
}

function parseOutput(stdout) {
  let result;
  try { result = JSON.parse(stdout); } catch { result = { text: stdout }; }
  if (!object(result) || (!Object.hasOwn(result, 'text') && !Object.hasOwn(result, 'files'))) result = { text: stdout };
  if (!exact(result, ['text', 'files']) || typeof result.text !== 'string') throw failure('TOOL_FAILED', 'Python returned an invalid result');
  if (Buffer.byteLength(result.text) > 65536) throw failure('TOOL_LIMIT', 'Python text exceeds 64 KiB');
  if (result.files !== undefined) {
    if (!Array.isArray(result.files) || result.files.length > 4) throw failure('TOOL_LIMIT', 'Python may return at most four files');
    const names = new Set();
    for (const file of result.files) {
      if (!exact(file, ['name', 'mimeType', 'data']) || typeof file.name !== 'string'
        || !/^[^./\\\x00-\x1f][^/\\\x00-\x1f]{0,118}\.(png|csv|txt)$/i.test(file.name) || names.has(file.name)
        || !['image/png', 'text/csv', 'text/plain'].includes(file.mimeType) || typeof file.data !== 'string'
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw failure('TOOL_FAILED', 'Python returned an invalid attachment');
      names.add(file.name);
      if (file.data.length > Math.ceil(MIB / 3) * 4) throw failure('TOOL_LIMIT', 'Python attachment exceeds 1 MiB');
      const bytes = Buffer.from(file.data, 'base64');
      if (bytes.length > MIB) throw failure('TOOL_LIMIT', 'Python attachment exceeds 1 MiB');
      const extension = file.name.split('.').at(-1).toLowerCase();
      if ({ png: 'image/png', csv: 'text/csv', txt: 'text/plain' }[extension] !== file.mimeType
        || (extension === 'png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        || (extension !== 'png' && (bytes.includes(0) || new TextDecoder('utf-8', { fatal: true }).decode(bytes) === undefined))) {
        throw failure('TOOL_FAILED', 'Python attachment content does not match its type');
      }
    }
  }
  return result;
}

export function createPythonRunner({ dockerCommand = 'docker' } = {}) {
  // Host env configures the user's Docker endpoint, never the container environment.
  function command(args, { signal, input, timeoutMs = 10000, limit = MIB, code = 'PYTHON_UNAVAILABLE' } = {}) {
    assertActive(signal);
    return new Promise((resolve, reject) => {
      const child = spawn(dockerCommand, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const out = []; let stdoutBytes = 0; let stderrBytes = 0; let error;
      const stop = (reason) => { error ??= reason; child.kill('SIGKILL'); };
      const cancel = () => stop(aborted());
      const timer = setTimeout(() => stop(failure('TOOL_TIMEOUT', 'Python operation timed out')), timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > limit) stop(failure('TOOL_LIMIT', 'Python output exceeds its byte limit'));
        else out.push(chunk);
      });
      child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; if (stderrBytes > MIB) stop(failure('TOOL_LIMIT', 'Python error output exceeds its byte limit')); });
      child.stdin.on('error', () => {}); // Early container exit may close stdin before payload delivery.
      child.once('error', () => { error ??= failure(code, 'Docker is unavailable'); });
      child.once('close', (exitCode) => {
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        if (error) reject(error);
        else if (exitCode !== 0) reject(failure(code, code === 'TOOL_FAILED' ? 'Python script failed' : 'Docker operation failed; check the runtime and selected image'));
        else {
          try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(out))); }
          catch { reject(failure('TOOL_FAILED', 'Python returned invalid UTF-8')); }
        }
      });
      child.stdin.end(input);
      if (signal?.aborted) cancel();
    });
  }

  async function inspectImage(image, signal) {
    if (typeof image !== 'string' || !IMAGE_REF.test(image)) throw failure('TOOL_POLICY_INVALID', 'Choose a valid Docker image');
    const info = JSON.parse(await command(['image', 'inspect', image], { signal }))[0];
    if (!IMAGE_ID.test(info?.Id) || info?.Os !== 'linux' || Object.keys(info.Config?.Volumes || {}).length) {
      throw failure('PYTHON_UNAVAILABLE', 'Python requires a Linux image without implicit volumes');
    }
    return info.Id;
  }

  async function container(imageId, args, { signal, input, timeoutMs = 30000, prepare = false } = {}) {
    assertActive(signal);
    const token = randomUUID(); const name = `mira-python-${token}`;
    let id; let result;
    try {
      const limits = ['--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '32', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--no-healthcheck', '--log-driver', 'none'];
      const isolation = prepare ? ['--network', 'bridge'] : ['--network', 'none', '--read-only', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777', '--shm-size', '1m', '--workdir', '/tmp'];
      id = (await command(['create', '--name', name, '--label', `${LABEL}=${token}`, '--pull', 'never', '-i', ...limits, ...isolation, '--entrypoint', 'python3', imageId, ...args], { signal })).trim();
      if (!/^[a-f0-9]{64}$/.test(id)) throw failure('PYTHON_UNAVAILABLE', 'Docker did not return a container identity');
      result = await command(['start', '-a', '-i', id], { signal, input, timeoutMs, limit: 6 * MIB, code: 'TOOL_FAILED' });
      assertActive(signal);
      if (prepare) return (await command(['commit', id], { signal, timeoutMs: 60000 })).trim();
      return result;
    } finally {
      // Resolve and verify only our random token; never remove a supplied name or prune Docker.
      let owned;
      try { owned = JSON.parse(await command(['container', 'inspect', name]))[0]; }
      catch (error) { if (id) throw failure('PYTHON_UNAVAILABLE', 'Could not verify Python container cleanup; check Docker'); }
      if (owned) {
        if (!/^[a-f0-9]{64}$/.test(owned.Id) || owned.Config?.Labels?.[LABEL] !== token) throw failure('PYTHON_UNAVAILABLE', 'Python container identity changed; cleanup refused');
        await command(['rm', '--force', owned.Id]);
      }
    }
  }

  async function status({ image = 'python:3.13-slim' } = {}, { signal } = {}) {
    let directory;
    try {
      assertActive(signal);
      const platform = (await command(['info', '--format', '{{.OSType}}'], { signal })).trim();
      if (platform !== 'linux') throw failure('PYTHON_UNAVAILABLE', 'Python isolation requires Docker Linux containers');
      const imageId = await inspectImage(image, signal);
      directory = await mkdtemp(join(tmpdir(), 'mira-python-probe-'));
      const sentinel = join(directory, 'host-only.txt');
      await writeFile(sentinel, randomUUID(), { flag: 'wx', mode: 0o600 });
      const payload = JSON.stringify({ code: PROBE, input: { sources: [], arguments: { sentinel } }, timeoutMs: 10000 });
      const checked = JSON.parse(await container(imageId, ['-I', '-u', '-c', SUPERVISOR], { signal, input: payload, timeoutMs: 10000 }));
      if (checked.isolated !== true || typeof checked.python !== 'string') throw failure('PYTHON_UNAVAILABLE', 'Python isolation probe failed');
      return { available: true, imageId, runtime: `Docker Linux · Python ${checked.python}` };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      return { available: false, reason: error.code === 'TOOL_FAILED' ? 'Python isolation probe failed; this environment cannot execute scripts' : error.message };
    } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }

  async function execute(request, { signal } = {}) {
    assertActive(signal);
    const { payload, timeoutMs } = validateExecution(request);
    const environment = await status({ image: request.imageId }, { signal });
    if (!environment.available) throw failure('PYTHON_UNAVAILABLE', environment.reason);
    const stdout = await container(request.imageId, ['-I', '-u', '-c', SUPERVISOR], { signal, input: payload, timeoutMs });
    try { return parseOutput(stdout); }
    catch (error) { if (error.code) throw error; throw failure('TOOL_FAILED', 'Python returned an invalid attachment'); }
  }

  async function prepare({ image = 'python:3.13-slim', dependencies = [] } = {}, { signal } = {}) {
    assertActive(signal);
    if (typeof image !== 'string' || !IMAGE_REF.test(image) || !Array.isArray(dependencies) || dependencies.length > 20 || !dependencies.every((item) => typeof item === 'string' && DEPENDENCY.test(item))) {
      throw failure('TOOL_POLICY_INVALID', 'Use a Docker image and up to 20 package==version dependencies');
    }
    await command(['pull', image], { signal, timeoutMs: 300000 });
    let imageId = await inspectImage(image, signal);
    if (dependencies.length) {
      imageId = await container(imageId, ['-I', '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--only-binary=:all:', '--target', '/opt/mira-deps', ...dependencies], { signal, prepare: true, timeoutMs: 300000 });
      imageId = await inspectImage(imageId, signal);
    }
    return status({ image: imageId }, { signal });
  }

  return { status, prepare, execute };
}
