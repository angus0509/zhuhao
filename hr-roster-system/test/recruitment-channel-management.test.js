const fs = require('fs');
const path = require('path');
const sourceService = require('../src/services/recruitment-source.service');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('sql/migrate-recruitment-channel-20260806.mysql.sql');
const employeeService = read('src/services/employee.service.js');
const routes = read('src/routes/recruitment-source.routes.js');
const sourceServiceCode = read('src/services/recruitment-source.service.js');
const page = read('public/index.html');
const app = read('public/app.js');

const normalized = sourceService.normalizeChannel({ channelName: '  员工转介绍  ', channelType: 4, recruiterId: '' });
if (normalized.channelName !== '员工转介绍' || normalized.channelType !== 4 || normalized.recruiterId !== null) throw new Error('招聘渠道标准化失败');

let dualRelationRejected = false;
try { sourceService.normalizeChannel({ channelName: '错误渠道', recruiterId: 1, supplierId: 2 }); } catch (error) { dualRelationRejected = error.message.includes('不能同时关联'); }
if (!dualRelationRejected) throw new Error('招聘渠道同时关联招聘人和供应商时未拦截');

if (!migration.includes('CREATE TABLE IF NOT EXISTS hr_recruitment_channel')) throw new Error('缺少招聘渠道幂等迁移');
if (!migration.includes('UPDATE hr_employee e') || !migration.includes('recruitment_channel_id')) throw new Error('历史招聘来源未归档回填');
if (!employeeService.includes('resolveRecruitmentChannel') || !employeeService.includes('已停用，请更换或先启用')) throw new Error('员工保存未自动关联渠道或未拦截停用渠道');
if (!routes.includes("router.get('/recruitment-channels'") || !routes.includes("router.post('/recruitment-channels'")) throw new Error('招聘渠道接口未注册');
if (!routes.includes("router.get('/recruitment-channels/:id/employees'")) throw new Error('招聘渠道关联员工接口未注册');
if (!sourceServiceCode.includes('customerNames') || !sourceServiceCode.includes('feeModes') || !sourceServiceCode.includes('employeeNames')) throw new Error('招聘渠道缺少员工、客户单位或费用模式关联统计');
if (!sourceServiceCode.includes("employeeScope(user, params, 'e', 'j')")) throw new Error('招聘渠道关联员工未执行数据范围隔离');
if (!page.includes('招聘渠道台账') || !page.includes('id="channelForm"')) throw new Error('招聘来源页面未增加统一渠道台账');
if (!page.includes('id="channelEmployeesModal"') || !page.includes('<th>费用模式</th>')) throw new Error('招聘渠道关联员工明细页面不完整');
if (!app.includes('ensureRecruitmentChannelOptions') || !page.includes('list="desktopRecruitmentChannelOptions"')) throw new Error('自由填写输入框未关联渠道建议');
if (!app.includes('openChannelEmployees') || !app.includes('data-view-channel-employees')) throw new Error('招聘渠道关联明细入口未实现');

console.log('recruitment-channel-management-tests-ok');
