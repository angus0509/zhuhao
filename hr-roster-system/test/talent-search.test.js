const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src/services/portal.service.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

assert.match(service, /async function listTalents\(companyId, user, query = \{\}\)/,
  '人才库服务必须接收搜索参数');
assert.match(service, /t\.name LIKE :keyword|t\.phone LIKE :keyword|t\.id_card_hash = :keywordHash/,
  '人才库搜索必须按姓名、手机号或身份证摘要检索');
assert.match(app, /loadTalents\([\s\S]*talentSearchInput/,
  '网页端人才库必须把搜索关键词传给加载函数');
assert.match(html, /id="talentSearchInput"/,
  '人才库页面缺少员工搜索输入框');

console.log('talent-search-tests-ok');
