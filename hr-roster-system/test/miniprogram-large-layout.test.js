const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const globalStyle = read('wechat-miniprogram/miniprogram/app.wxss');
assertIncludes(globalStyle, '--text-base: 30rpx', '小程序未启用大字正文令牌');
assertIncludes(globalStyle, '--tap-height: 96rpx', '小程序主操作点击区域仍过小');
assertIncludes(globalStyle, '--title-size: 48rpx', '小程序页面标题未统一放大');
assertIncludes(globalStyle, 'font-size: var(--text-base)', '小程序未应用全局大字正文');

const homeStyle = read('wechat-miniprogram/miniprogram/pages/home/index.wxss');
assertIncludes(homeStyle, 'grid-template-columns: repeat(2, 1fr)', '首页快捷功能未改为大卡片两列布局');
assertIncludes(homeStyle, 'min-height: 196rpx', '首页快捷功能卡片可点击画面过小');
assertIncludes(homeStyle, 'font-size: 58rpx', '首页风险指标数字不够醒目');

const employeeWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const employeeStyle = read('wechat-miniprogram/miniprogram/pages/employees/index.wxss');
assertIncludes(employeeWxml, 'class="site-status-grid"', '员工状态未合并到驻厂大字管理面板');
assertIncludes(employeeStyle, 'grid-template-columns: repeat(3, 1fr)', '驻厂指标仍使用过密布局');
assertIncludes(employeeStyle, 'min-width: 142rpx', '员工状态筛选点击区域过小');
assertIncludes(employeeStyle, 'min-height: 72rpx', '员工卡片操作按钮过小');

const taskJs = read('wechat-miniprogram/miniprogram/pages/tasks/index.js');
const taskWxml = read('wechat-miniprogram/miniprogram/pages/tasks/index.wxml');
const taskStyle = read('wechat-miniprogram/miniprogram/pages/tasks/index.wxss');
assertIncludes(taskJs, 'contractCount:', '待办页未统计合同具体数量');
assertIncludes(taskWxml, '合同和雇主险 {{contractCount}}', '待办筛选未显示合并合规人数');
assertIncludes(taskStyle, 'min-height: 96rpx', '待办处理按钮点击区域过小');
assertIncludes(taskStyle, 'font-size: 32rpx', '待办事项标题字号过小');

console.log('小程序工业现场大字布局检查通过。');
