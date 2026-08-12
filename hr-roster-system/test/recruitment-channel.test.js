const fs = require('fs');
const path = require('path');
const service = require('../src/services/employee.service');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const miniRoot = path.join(root, 'wechat-miniprogram/miniprogram');
const hasMiniProgramSource = fs.existsSync(miniRoot);

const freeText = service.normalizeRecruitmentChannel({ channelSource: '现场招聘会' });
if (freeText.channelSource !== '现场招聘会' || freeText.recruitmentSourceType !== null || freeText.recruiterId !== null || freeText.supplierId !== null) {
  throw new Error('自由填写招聘渠道映射不正确');
}

const legacy = service.normalizeRecruitmentChannel({ recruitmentSourceType: 1, recruiterId: 9 });
if (legacy.recruitmentSourceType !== 1 || legacy.recruiterId !== 9) throw new Error('旧版招聘来源请求不兼容');

let tooLongRejected = false;
try {
  service.normalizeRecruitmentChannel({ channelSource: '渠'.repeat(101) });
} catch (error) {
  tooLongRejected = error.message.includes('招聘渠道最多填写100个字符');
}
if (!tooLongRejected) throw new Error('超长招聘渠道未被拦截');

if ((page.match(/name="channelSource"/g) || []).length < 2) throw new Error('桌面端和手机Web必须使用自由填写招聘渠道');
if ((page.match(/name="channelSource"[^>]*required/g) || []).length) throw new Error('招聘渠道不应强制必填');
if (page.includes('data-recruitment-channel') || page.includes('formRecruitmentChannelSelect')) throw new Error('员工表单仍存在招聘渠道下拉框');
if (!app.includes('channelSource: row.recruitmentChannelName || row.channelSource')) throw new Error('编辑员工时未回填自由文本招聘渠道');
if (!page.includes('class="col-channel"') || !page.includes('data-sort-key="recruitmentChannelName"') || !page.includes('>招聘渠道</th>')) {
  throw new Error('员工列表未统一显示可排序的招聘渠道列');
}

// Web 生产发布包按设计不包含小程序源码；仅在源码存在时校验小程序契约。
if (hasMiniProgramSource) {
  const miniJs = fs.readFileSync(path.join(miniRoot, 'pages/employees/add/index.js'), 'utf8');
  const miniWxml = fs.readFileSync(path.join(miniRoot, 'pages/employees/add/index.wxml'), 'utf8');
  const miniDetailWxml = fs.readFileSync(path.join(miniRoot, 'pages/employees/detail/index.wxml'), 'utf8');
  if (miniJs.includes("if (!f.channelSource.trim())") || !miniWxml.includes('data-field="channelSource"')) throw new Error('小程序招聘渠道未改为选填');
  if (!miniDetailWxml.includes("basic.recruitmentChannelName || '-'")) throw new Error('小程序员工详情未统一显示招聘渠道');
}

console.log('recruitment-channel-tests-ok');
