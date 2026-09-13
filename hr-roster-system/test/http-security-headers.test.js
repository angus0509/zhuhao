const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nginx = fs.readFileSync(path.resolve(__dirname, '../deploy/nginx/lczpt.conf'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');

assert.match(nginx, /server_name\s+lczpt\.com\s+www\.lczpt\.com;/, 'Nginx 必须同时覆盖主域名和 www 域名');
assert.match(
  nginx,
  /add_header\s+Strict-Transport-Security\s+"max-age=31536000; includeSubDomains; preload"\s+always;/,
  'Nginx 缺少一年期 HSTS 安全响应头'
);
assert.match(
  nginx,
  /proxy_hide_header\s+Strict-Transport-Security;/,
  'Nginx 必须隐藏应用层 HSTS 兜底，避免向浏览器返回重复安全头'
);
assert.match(
  app,
  /env\.nodeEnv\s*===\s*'production'[\s\S]{0,200}Strict-Transport-Security[\s\S]{0,200}max-age=31536000; includeSubDomains; preload/,
  '生产应用响应缺少 HSTS 兜底，常规容器部署后可能仍不生效'
);

console.log('http-security-headers-tests-ok');
