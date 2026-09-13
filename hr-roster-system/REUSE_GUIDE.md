# 优企云 HR 系统复用归档说明

本归档用于后续为其他人力资源服务公司建立独立环境。源码包含 Web 管理端、手机 Web 适配、小程序、Express + MySQL 后端、数据库迁移、部署脚本和自动化测试。

## 使用前必须替换

1. 复制 `.env.production.example` 为 `.env.production`，填写新企业自己的数据库密码、JWT 密钥、数据加密密钥、微信和腾讯云配置。
2. 使用新的微信小程序 AppID、AppSecret，不得复用其他企业配置。
3. 修改 `CORS_ORIGINS`、Nginx 域名和小程序 API 地址。
4. 首次上线后立即修改默认管理员密码，并按新企业创建角色和账号。
5. 生产环境必须使用全新数据库，不得导入其他企业的员工、身份证、银行卡、工资或附件数据。

## 归档边界

- 已排除：`.env`、`.env.production`、运行数据、上传附件、`node_modules`、`.runtime`、Git 元数据和发布候选状态文件。
- 保留：示例环境配置、数据库结构与幂等迁移、源代码、前端、小程序、部署脚本、测试和通用开发文档。
- 归档不包含任何生产私钥、Token、AppSecret 或真实业务数据。

## 启动与验证

```bash
npm ci
npm run check
npm run lint
npm audit --audit-level=high
```

生产部署请使用 `scripts/build-release-package.sh`、`scripts/verify-release-package.sh` 和 `scripts/deploy-production.sh`，不要直接把本机配置文件复制到服务器。

## 多企业复用原则

- 每家企业使用独立数据库、密钥、微信小程序和域名。
- 员工、工资、黑名单、附件和审计日志必须保持企业隔离。
- 驻厂、HR、薪资和管理员权限按新企业实际组织结构重新授权。
- 任何真实员工数据迁移前，先完成脱敏测试和数据库备份。
