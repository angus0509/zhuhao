const assert = require('assert');
const { paging, boundedLimit } = require('../src/utils/pagination');

assert.deepStrictEqual(paging({ page: '2', pageSize: '50' }), { page: 2, pageSize: 50, offset: 50 });
assert.deepStrictEqual(paging({ page: 'abc', pageSize: 'NaN' }), { page: 1, pageSize: 20, offset: 0 });
assert.deepStrictEqual(paging({ page: '-1', pageSize: '0' }), { page: 1, pageSize: 20, offset: 0 });
assert.deepStrictEqual(paging({ page: '1.5', pageSize: '20.2' }), { page: 1, pageSize: 20, offset: 0 });
assert.deepStrictEqual(paging({ page: '1', pageSize: '2000' }, { maxPageSize: 2000 }), { page: 1, pageSize: 2000, offset: 0 });
assert.strictEqual(boundedLimit('30', 20, 50), 30);
assert.strictEqual(boundedLimit('abc', 20, 50), 20);
assert.strictEqual(boundedLimit('1000', 20, 50), 50);

console.log('pagination-tests-ok');
