const { createError } = require('../utils/response');

const CATEGORIES = new Set(['income', 'deduction', 'summary', 'display']);
const SENSITIVE_LABEL_ZH = /(?:姓名|工号|员工编号|人员编号|身份证|证件号|手机号|手机号码|联系电话|银行卡|银行账号|卡号)/;
const SENSITIVE_LABEL_EN = /(?:^|[^a-z])(?:(?:employee|staff|worker)\s*(?:name|no|number|id)|full\s*name|id\s*(?:card|number)|national\s*id|phone|mobile|telephone|tel|contact\s*(?:phone|number)|bank\s*(?:account|card)|account\s*(?:no|number)|card\s*(?:no|number)|iban)(?:$|[^a-z])/i;
const MAX_ITEMS = 80;
const MAX_SERIALIZED_BYTES = 64 * 1024;

function isSensitiveLabel(value) {
  const label = String(value || '').trim();
  return SENSITIVE_LABEL_ZH.test(label) || /^name$/i.test(label) || SENSITIVE_LABEL_EN.test(label);
}

function normalizeItemSnapshot(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw createError('工资项目格式不正确');
  if (value.length > MAX_ITEMS) throw createError(`单人工资项目最多${MAX_ITEMS}项`);

  const sortOrders = new Set();
  const items = value.map((source, index) => {
    const label = String(source?.label || '').trim();
    const category = String(source?.category || '').trim();
    const sortOrder = Number(source?.sortOrder);
    if (!label || label.length > 50) throw createError(`第${index + 1}个工资项目名称应为1至50个字符`);
    if (isSensitiveLabel(label)) throw createError(`工资项目“${label}”包含敏感身份字段，禁止保存`);
    if (!CATEGORIES.has(category)) throw createError(`工资项目“${label}”分类无效`);
    if (!Number.isInteger(sortOrder) || sortOrder <= 0 || sortOrders.has(sortOrder)) {
      throw createError('工资项目排序号重复或无效');
    }
    sortOrders.add(sortOrder);

    const itemValue = String(source?.value == null ? '' : source.value).trim();
    if (itemValue.startsWith('=')) throw createError(`工资项目“${label}”不能使用公式`);
    return { label, value: itemValue, category: 'display', sortOrder };
  }).sort((left, right) => left.sortOrder - right.sortOrder);

  if (Buffer.byteLength(JSON.stringify(items), 'utf8') > MAX_SERIALIZED_BYTES) {
    throw createError('单人工资项目数据不能超过64KB');
  }
  return items;
}

module.exports = { normalizeItemSnapshot, isSensitiveLabel };
