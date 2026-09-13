const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(baseUrl) {
  for (let i = 0; i < 30; i += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch (_error) {
      // 继续等待原型服务启动。
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('本地原型启动超时');
}

async function run() {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    await waitFor(baseUrl);
    const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin@123456' }) });
    const token = (await login.json()).data.token;
    const headers = { Authorization: `Bearer ${token}` };
    const [analytics, users, roles, projects, permissions, departments, logs] = await Promise.all([
      fetch(`${baseUrl}/api/analytics/dashboard`, { headers }),
      fetch(`${baseUrl}/api/system/users`, { headers }),
      fetch(`${baseUrl}/api/system/roles`, { headers }),
      fetch(`${baseUrl}/api/system/projects`, { headers }),
      fetch(`${baseUrl}/api/system/permissions`, { headers }),
      fetch(`${baseUrl}/api/system/departments`, { headers }),
      fetch(`${baseUrl}/api/audit-logs`, { headers })
    ]);
    assert.equal(analytics.status, 200, '驾驶舱接口应成功返回');
    const analyticsData = (await analytics.json()).data;
    assert.ok(Array.isArray(analyticsData.customerDistribution), '驾驶舱应提供客户单位分布字段');
    for (const [name, response] of Object.entries({ users, roles, projects, permissions, departments, logs })) {
      assert.equal(response.status, 200, `${name}页面接口不应返回404`);
      const payload = await response.json();
      assert.equal(payload.code, 0, `${name}页面接口应使用统一成功响应`);
    }
    console.log('prototype-page-compatibility-tests-ok');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
