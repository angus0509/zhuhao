const dictionaries = {
  employeeStatus: { 1: '待入职', 2: '在职', 3: '离职', 4: '黑名单', 5: '未入职', 6: '面试' },
  employmentType: { 1: '全职', 2: '兼职', 3: '劳务', 4: '实习', 5: '外包', 6: '派遣' },
  workType: { 1: '计时', 2: '计件', 3: '混合' },
  gender: { 0: '未知', 1: '男', 2: '女' },
  socialStatus: { 0: '未参保', 1: '已参保', 2: '停保' },
  signStatus: { 0: '未签', 1: '已签', 2: '作废' },
  riskLevel: { 1: '低', 2: '中', 3: '高' },
  handleStatus: { 0: '未处理', 1: '处理中', 2: '已处理', 3: '忽略' },
  certType: { 1: '身份证', 2: '健康证', 3: '上岗证', 4: '特种作业证', 5: '学历证' }
};

function label(type, value, fallback = '') {
  return dictionaries[type]?.[Number(value)] || fallback;
}

module.exports = {
  dictionaries,
  label
};
