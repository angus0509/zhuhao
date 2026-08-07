const assert = require('assert');
const { fail, createError, asyncHandler } = require('../src/utils/response');

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

async function main() {
  const serverResponse = responseRecorder();
  fail(serverResponse, new Error('Incorrect arguments to mysqld_stmt_execute'));
  assert.strictEqual(serverResponse.statusCode, 500);
  assert.strictEqual(serverResponse.payload.message, '服务器内部错误，请稍后重试');

  const validationResponse = responseRecorder();
  fail(validationResponse, createError('姓名不能为空', 400));
  assert.strictEqual(validationResponse.statusCode, 400);
  assert.strictEqual(validationResponse.payload.message, '姓名不能为空');

  const expectedError = new Error('database failed');
  let forwardedError = null;
  await asyncHandler(async () => {
    throw expectedError;
  })({}, responseRecorder(), error => {
    forwardedError = error;
  });
  assert.strictEqual(forwardedError, expectedError);

  console.log('error-handling-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
