const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const html = read('public/index.html');
const app = read('public/app.js');
const router = read('public/js/core/router.js');
const state = read('public/js/core/state.js');
const service = read('src/services/risk.service.js');
const migration = read('sql/migrate-unified-risk-center-20260810.mysql.sql');
const complianceMigration = read('sql/migrate-onboarding-compliance-risk-20260810.mysql.sql');
const deploy = read('scripts/deploy-production.sh');
const verifyRelease = read('scripts/verify-release-package.sh');
const packageJson = JSON.parse(read('package.json'));

if ((html.match(/data-view="riskCases"/g) || []).length) throw new Error('风险预警和用工风险管理仍是两个菜单入口');
assertIncludes(html, '新员工入职合规', '风险中心未简化为新员工入职合规');
assertIncludes(html, '劳动合同', '风险中心缺少劳动合同检查项');
assertIncludes(html, '雇主险', '风险中心缺少雇主险检查项');
assertIncludes(html, 'id="riskDetailPanel"', '风险中心缺少统一详情面板');
assertIncludes(html, 'id="riskComplianceFilter"', '风险中心缺少简洁合规状态筛选');
if (html.includes('class="risk-workflow"')) throw new Error('风险中心仍保留复杂整改流程条');
if (html.includes('id="riskCategoryFilter"') || html.includes('id="riskLevelFilter"')) throw new Error('风险中心仍保留不必要的多维筛选');
assertIncludes(html, 'id="riskCenterScanButton" type="button" data-action-perm="risk:scan"', '风险扫描按钮未按扫描权限隔离');

assertIncludes(state, 'risks: []', '前端状态未统一保存风险数据');
assertIncludes(state, 'riskCases: []', '前端状态未统一保存整改任务');
assertIncludes(app, 'async function loadRiskCenter()', '缺少统一风险中心加载函数');
assertIncludes(app, 'function buildOnboardingComplianceRows', '风险中心未按员工合并合同与雇主险状态');
assertIncludes(app, 'function renderRiskDetail', '风险点击后缺少详情渲染');
assertIncludes(app, 'data-risk-detail', '风险列表项没有详情点击入口');
assertIncludes(app, 'data-risk-preset', '风险指标卡没有快捷筛选入口');
assertIncludes(app, "$('#unresolvedRiskTotal').closest('.metric-cell')", '顶部未处理风险指标没有绑定点击');
assertIncludes(app, "$('#unsignedTotal').closest('.metric-cell')", '顶部未签合同指标没有绑定点击');
assertIncludes(app, "data-action=\"contract\"", '未签合同时缺少直接登记合同入口');
assertIncludes(app, "data-action=\"social\"", '未增保时缺少直接办理雇主险入口');

assertIncludes(router, "riskCases: 'risk'", '历史风险整改入口没有兼容跳转到统一风险中心');
assertIncludes(service, 'customer_name', '风险接口缺少客户单位上下文');
assertIncludes(service, "r.risk_type IN (1,7)", '风险接口仍返回非合同/雇主险风险');
assertIncludes(service, "e.lifecycle_status <> 'OFFBOARDING'", '离职交接员工仍会进入新员工入职合规');
assertIncludes(service, "handle_remark='系统复查：雇主险当前未生效'", '雇主险减保或失效后不会重新进入待办');
assertIncludes(service, 'contract_signed', '风险接口缺少合同签订实时状态');
assertIncludes(service, 'employer_insurance_active', '风险接口缺少雇主险实时状态');

const employeeService = read('src/services/employee.service.js');
assertIncludes(employeeService, 'async function createOnboardingCompliance', '新员工录入缺少统一入职合规初始化');
assertIncludes(employeeService, 'riskType: 7', '新员工雇主险提醒仍使用错误风险类型');
assertIncludes(employeeService, 'riskKey: `contract_missing:${employeeId}`', '入职提醒与扫描的合同风险键不一致');
assertIncludes(employeeService, 'riskKey: `employer_insurance_missing:${employeeId}`', '入职提醒与扫描的雇主险风险键不一致');
assertIncludes(employeeService, "taskType: 'CONTRACT'", '新员工入职未生成合同待办');
assertIncludes(employeeService, "if (employeeStatus === 2)", '直接入职未初始化合同和雇主险合规');
assertIncludes(employeeService, "SET handle_status=2,handler_id=:operatorId,handle_time=NOW(),handle_remark='劳动合同已签订'", '签订合同后未自动关闭合同风险');
assertIncludes(employeeService, "SET handle_status=2,handler_id=:operatorId,handle_time=NOW(),handle_remark='雇主险已增保'", '雇主险增保后未使用正确字段关闭风险');

assertIncludes(migration, "old_p.permission_code='riskCase:menu'", '迁移未识别旧风险整改菜单授权');
assertIncludes(migration, "new_p.permission_code='risk:menu'", '迁移未将旧角色授权补充到统一风险中心');
assertIncludes(migration, "permission_name='用工风险中心'", '迁移未更新统一风险中心名称');
assertIncludes(migration, "route_path='/hr/risks'", '迁移未统一风险中心路由');
assertIncludes(migration, "permission_code='riskCase:menu'", '迁移未处理旧风险整改菜单');
assertIncludes(migration, 'status=0', '迁移未停用旧风险整改菜单');
assertIncludes(complianceMigration, "risk_type NOT IN (1,7)", '迁移未停用非核心入职风险');
assertIncludes(complianceMigration, "CONCAT('contract_missing:',e.id)", '迁移未补齐历史员工合同风险');
assertIncludes(complianceMigration, "CONCAT('employer_insurance_missing:',e.id)", '迁移未补齐历史员工雇主险风险');
assertIncludes(complianceMigration, "lifecycle_status='ONBOARDING'", '迁移未修复入职合规生命周期状态');
assertIncludes(complianceMigration, "handle_remark='系统复查：劳动合同当前未签订'", '迁移未重新打开历史误关闭的合同风险');
assertIncludes(complianceMigration, "handle_remark='系统复查：雇主险当前未生效'", '迁移未重新打开历史误关闭的雇主险风险');
assertIncludes(deploy, 'migrate-unified-risk-center-20260810.mysql.sql', '生产部署未执行统一风险中心迁移');
assertIncludes(deploy, 'migrate-onboarding-compliance-risk-20260810.mysql.sql', '生产部署未执行入职合规关联修复迁移');
assertIncludes(deploy, "permission_code='riskCase:menu' AND status=0", '生产部署未校验旧风险菜单已停用');
assertIncludes(verifyRelease, 'migrate-unified-risk-center-20260810.mysql.sql', '发布包未校验统一风险中心迁移');

if (packageJson.scripts['test:risk-center'] !== 'node test/risk-center-unified.test.js') {
  throw new Error('package.json 缺少风险中心专项测试命令');
}

console.log('新员工合同与雇主险入职合规检查通过。');
