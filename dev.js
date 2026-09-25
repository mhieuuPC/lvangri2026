import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backendDir = path.join(__dirname, 'backend');
const frontendDir = path.join(__dirname, 'frontend');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log('\x1b[32m%s\x1b[0m', '=====================================================');
console.log('\x1b[32m%s\x1b[0m', '🌾  LÚA VÀNG AGRI - KHỞI CHẠY MÁY CHỦ FULLSTACK  🌾');
console.log('\x1b[32m%s\x1b[0m', '=====================================================');
console.log('\x1b[36m⚡ Backend API:\x1b[0m   http://localhost:3000');
console.log('\x1b[35m🎨 Frontend Web:\x1b[0m  http://localhost:5173');
console.log('\x1b[90m%s\x1b[0m', 'Nhấn Ctrl+C để dừng đồng thời cả 2 server.\n');

const runningProcesses = [];

function freePort(port) {
  if (process.platform === 'win32') {
    try {
      const stdout = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const state = parts[parts.length - 2];
        const pid = parts[parts.length - 1];
        if (state === 'LISTENING' && pid && pid !== '0' && pid !== process.pid.toString()) {
          try {
            execSync(`taskkill /pid ${pid} /F`, { stdio: 'ignore' });
            console.log(`\x1b[33m[PORT CLEANUP]\x1b[0m Đã giải phóng cổng ${port} (tiến trình PID ${pid})`);
          } catch (e) {}
        }
      }
    } catch (e) {}
  }
}

function pipeOutput(proc, prefix, colorCode) {
  const rlOut = readline.createInterface({ input: proc.stdout });
  rlOut.on('line', (line) => {
    console.log(`${colorCode}${prefix}\x1b[0m ${line}`);
  });

  const rlErr = readline.createInterface({ input: proc.stderr });
  rlErr.on('line', (line) => {
    console.error(`${colorCode}${prefix} [ERROR]\x1b[0m ${line}`);
  });
}

function startBackend() {
  const proc = spawn(npmCmd, ['run', 'dev'], {
    cwd: backendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  runningProcesses.push(proc);
  pipeOutput(proc, '[BACKEND]', '\x1b[36m');

  proc.on('close', (code) => {
    console.log(`\x1b[36m[BACKEND]\x1b[0m Quá trình kết thúc với mã: ${code}`);
  });
}

function startFrontend() {
  const proc = spawn(npmCmd, ['run', 'dev'], {
    cwd: frontendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  runningProcesses.push(proc);
  pipeOutput(proc, '[FRONTEND]', '\x1b[32m');

  proc.on('close', (code) => {
    console.log(`\x1b[32m[FRONTEND]\x1b[0m Quá trình kết thúc với mã: ${code}`);
  });
}

function cleanup() {
  console.log('\n\x1b[33mĐang tắt toàn bộ server...\x1b[0m');
  for (const proc of runningProcesses) {
    if (proc && proc.pid) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
        } else {
          proc.kill('SIGTERM');
        }
      } catch (e) {}
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

freePort(3000);
freePort(5173);

startBackend();
startFrontend();
