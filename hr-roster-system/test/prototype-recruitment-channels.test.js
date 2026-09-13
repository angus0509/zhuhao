const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch (_error) {
      // 服务尚未启动，继续短暂轮询。
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('本地原型服务启动超时');
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });

  try {
    await waitForServer(baseUrl);
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'Admin@123456' })
    });
    const loginPayload = await loginResponse.json();
    assert.equal(loginResponse.status, 200, '本地管理员应能登录原型');

    const response = await fetch(`${baseUrl}/api/recruitment-channels`, {
      headers: { Authorization: `Bearer ${loginPayload.data.token}` }
    });
    const payload = await response.json();
    assert.equal(response.status, 200, '招聘渠道页面不应收到“接口不存在”');
    assert.equal(payload.code, 0, '招聘渠道接口应使用统一成功响应');
    assert.ok(Array.isArray(payload.data), '招聘渠道接口应返回数组');
    console.log('prototype-recruitment-channels-tests-ok');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    if (stderr) process.stderr.write(stderr);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
