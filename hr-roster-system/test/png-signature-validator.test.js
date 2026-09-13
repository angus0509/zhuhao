const assert = require('node:assert/strict');
const { validatePng } = require('../src/utils/png-validator');

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const result = validatePng(validPng, {
  maxBytes: 1024,
  maxWidth: 100,
  maxHeight: 100,
  maxPixels: 10000
});
assert.equal(result.width, 1);
assert.equal(result.height, 1);
assert.match(result.sha256, /^[a-f0-9]{64}$/);

assert.throws(() => validatePng(Buffer.from('not-a-png')), /PNG|签名/);
assert.throws(() => validatePng(validPng.subarray(0, 24)), /PNG|签名/);
assert.throws(() => validatePng(validPng, { maxBytes: validPng.length - 1 }), /1MB|大小|过大/);
assert.throws(() => validatePng(validPng, { maxWidth: 0, maxHeight: 100, maxPixels: 100 }), /尺寸/);

const corrupted = Buffer.from(validPng);
corrupted[corrupted.length - 5] ^= 0xff;
assert.throws(() => validatePng(corrupted), /PNG|签名/);

console.log('png-signature-validator-tests-ok');
