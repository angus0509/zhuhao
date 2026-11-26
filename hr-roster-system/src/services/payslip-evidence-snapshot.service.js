const crypto = require('crypto');
const { createError } = require('../utils/response');
const { isSensitiveLabel } = require('./payroll-item-snapshot.service');

const SNAPSHOT_SCHEMA_VERSION = '1.0';
const MAX_ITEMS = 80;
const CATEGORIES = new Set(['income', 'deduction', 'summary', 'display']);
const MONETARY_CATEGORIES = new Set(['income', 'deduction', 'summary']);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      const item = value[key];
      if (item !== undefined) result[key] = canonicalize(item);
      return result;
    }, Object.create(null));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw createError('工资条证据快照包含无效数字');
  }
  return value;
}

function canonicalStringify(value) {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw createError('工资条证据快照无法序列化');
  return serialized;
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw createError(`${label}无效`);
  return result;
}

function boundedText(value, label, maxLength, required = false) {
  const result = String(value || '').trim();
  if ((required && !result) || result.length > maxLength) throw createError(`${label}无效`);
  return result;
}

function parseItems(value) {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_error) {
      throw createError('工资项目格式不正确');
    }
  }
  if (!Array.isArray(source) || source.length === 0) throw createError('工资条缺少展示项目');
  if (source.length > MAX_ITEMS) throw createError(`单人工资项目最多${MAX_ITEMS}项`);

  const sortOrders = new Set();
  return source.map((item, index) => {
    const name = String(item?.label || '').trim();
    const category = String(item?.category || '').trim();
    const sortOrder = Number(item?.sortOrder);
    if (!name || name.length > 50) throw createError(`第${index + 1}个工资项目名称无效`);
    if (isSensitiveLabel(name)) throw createError(`工资项目“${name}”包含敏感身份字段`);
    if (!CATEGORIES.has(category)) throw createError(`工资项目“${name}”分类无效`);
    if (!Number.isSafeInteger(sortOrder) || sortOrder <= 0 || sortOrders.has(sortOrder)) {
      throw createError('工资项目排序号重复或无效');
    }
    sortOrders.add(sortOrder);

    if (MONETARY_CATEGORIES.has(category)) {
      const amount = Number(item?.value);
      if (!Number.isFinite(amount) || amount < 0) throw createError(`工资项目“${name}”金额无效`);
      return { name, value: amount.toFixed(2), sortOrder };
    }
    const itemValue = String(item?.value == null ? '' : item.value);
    if (itemValue.trim().startsWith('=')) throw createError(`工资项目“${name}”不能使用公式`);
    return { name, value: itemValue, sortOrder };
  }).sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ name, value }) => ({ name, value }));
}

function buildPayslipEvidenceSnapshot(row = {}) {
  const salaryMonth = String(row.salaryMonth || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(salaryMonth)) throw createError('工资月份无效');
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    companyId: positiveInteger(row.companyId, '企业ID'),
    salaryDetailId: positiveInteger(row.salaryDetailId, '工资明细ID'),
    salaryMonth,
    employeeId: positiveInteger(row.employeeId, '员工ID'),
    employeeName: boundedText(row.employeeName, '员工姓名', 100, true),
    customerName: boundedText(row.customerName, '客户名称', 200),
    projectName: boundedText(row.projectName, '项目名称', 200),
    items: parseItems(row.itemSnapshot)
  };
}

function hashPayslipEvidenceSnapshot(snapshot) {
  return crypto.createHash('sha256').update(canonicalStringify(snapshot), 'utf8').digest('hex');
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  canonicalStringify,
  buildPayslipEvidenceSnapshot,
  hashPayslipEvidenceSnapshot
};
