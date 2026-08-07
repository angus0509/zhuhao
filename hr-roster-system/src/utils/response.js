function success(res, data = null, message = 'success') {
  return res.json({
    code: 0,
    message,
    data
  });
}

function fail(res, error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const message = status >= 500 && error?.expose !== true
    ? '服务器内部错误，请稍后重试'
    : (error?.message || '服务器错误');
  return res.status(status).json({
    code: status,
    message,
    data: null
  });
}

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

function logApiError(error, req) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (status < 500) return;
  const context = {
    method: req?.method || '',
    path: String(req?.originalUrl || req?.path || '').split('?')[0],
    status,
    errorName: error?.name || 'Error',
    errorCode: error?.code || '',
    companyId: Number(req?.companyId || 0),
    userId: Number(req?.user?.id || 0)
  };
  // 不记录请求体、查询参数、Token 或数据库错误原文，防止身份证等敏感数据进入日志。
  const stackFrames = String(error?.stack || '').split('\n').slice(1, 8).join('\n');
  console.error(`[api-error] ${JSON.stringify(context)}${stackFrames ? `\n${stackFrames}` : ''}`);
}

module.exports = {
  success,
  fail,
  createError,
  asyncHandler,
  logApiError
};
