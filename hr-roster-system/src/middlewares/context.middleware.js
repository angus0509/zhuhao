const env = require('../config/env');

function attachContext(req, _res, next) {
  req.companyId = Number(req.header('x-company-id') || env.defaultCompanyId);
  req.operatorId = Number(req.header('x-operator-id') || 0);
  next();
}

module.exports = {
  attachContext
};
