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
if (/用工风险清单|id="riskStatusFilter"|id="riskTableBody"|id="riskDetailModal"/.test(html)) throw new Error('网页端仍保留已下线风险页面');
if (html.includes('class="risk-workflow"')) throw new Error('风险中心仍保留复杂整改流程条');
if (html.includes('id="riskCategoryFilter"') || html.includes('id="riskLevelFilter"')) throw new Error('风险中心仍保留不必要的多维筛选');
if (/riskCenterScanButton|riskCaseForm|contractForm|socialForm|complianceForm/.test(html)) throw new Error('网页风险中心仍保留已取消的扫描或办理入口');

assertIncludes(state, 'risks: []', '前端状态未统一保存风险数据');
if (state.includes('riskCases: []')) throw new Error('前端仍保存已取消的整改任务状态');
assertIncludes(app, 'async function loadRiskCenter()', '缺少统一风险中心加载函数');
assertIncludes(app, 'buildRiskWorkbench(state.risks', '风险中心未使用统一筛选模型');
assertIncludes(app, 'data-risk-row', '风险列表项缺少选中状态');
assertIncludes(app, 'data-risk-employee', '风险列表项缺少员工档案入口');
assertIncludes(app, 'data-risk-preset', '风险指标卡没有快捷筛选入口');
if (!/id="unresolvedRiskTotal"[\s\S]{0,80}|metric-cell danger metric-action hidden/.test(html)) throw new Error('顶部历史风险指标未保持隐藏兼容');
if (/openContractModal|openSocialModal|submitOnboardingCompliance/.test(app)) throw new Error('网页仍保留合同或雇主险办理流程');

assertIncludes(router, "riskCases: 'office'", '历史风险整改入口未安全回到办公中心');
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
assertIncludes(employeeService, "taskType: 'ONBOARDING_COMPLIANCE'", '新员工入职未生成合同与雇主险合并待办');
const onboardBlock = employeeService.match(/async function onboardEmployee[\s\S]*?\n}\n\nasync function handleInterviewResult/)?.[0] || '';
if (/createOnboardingCompliance|ONBOARDING_COMPLIANCE/.test(onboardBlock)) {
  throw new Error('驻厂确认入职仍自动生成合同和雇主险合规待办');
}
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

console.log('简化用工风险中心与后端历史风险兼容检查通过。');
