const service = require('../services/work-task.service');
const { success, asyncHandler } = require('../utils/response');

exports.list = asyncHandler(async (req, res) => {
  success(res, await service.listTasks(req.companyId, req.query, req.user));
});

exports.start = asyncHandler(async (req, res) => {
  success(res, await service.startTask(req.companyId, Number(req.params.id), req.operatorId, req.user), '待办已开始处理');
});

exports.complete = asyncHandler(async (req, res) => {
  success(res, await service.completeTask(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user), '待办已完成');
});
