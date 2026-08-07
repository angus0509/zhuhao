function positiveInteger(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function paging(query = {}, options = {}) {
  const defaultPageSize = positiveInteger(options.defaultPageSize, 20, 10000);
  const maxPageSize = positiveInteger(options.maxPageSize, 200, 10000);
  const page = positiveInteger(query.page, 1, 1000000);
  const pageSize = positiveInteger(query.pageSize, defaultPageSize, maxPageSize);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function boundedLimit(value, fallback = 20, max = 50) {
  const safeFallback = positiveInteger(fallback, 20, max);
  return positiveInteger(value, safeFallback, max);
}

module.exports = {
  positiveInteger,
  paging,
  boundedLimit
};
