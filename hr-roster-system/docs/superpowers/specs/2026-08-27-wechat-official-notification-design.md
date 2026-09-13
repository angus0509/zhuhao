# 服务号通知设计

## 目标

为“优企云”增加微信公众号服务号通知能力，支持员工绑定服务号后接收工资条发布与待签收提醒，同时保留小程序登录和现有短信流程不变。

## 边界

- 服务号 `openid` 与小程序 `openid` 分开保存。
- 绑定只接受 OAuth 返回的 `unionid` 精确匹配；无法匹配时拒绝绑定。
- 工资条发布事务只创建通知任务，不同步调用微信接口。
- 定时任务每分钟批量处理，失败按 60/300/1800 秒重试。
- 通知正文不包含身份证、银行卡、工资金额或明细，只包含月份、状态和固定入口。
- 所有管理端查询强制带企业和项目数据范围；员工只能操作自己的绑定。

## 数据流

员工关注服务号 → OAuth 授权回调 → unionid 匹配员工 → 写入绑定表 → 工资条发布后写入通知队列 → scheduler 发送 → 记录微信返回码和审计摘要。

## 配置

新增环境变量：`WECHAT_OFFICIAL_APPID`、`WECHAT_OFFICIAL_SECRET`、`WECHAT_OFFICIAL_TEMPLATE_PAYSLIP_PUBLISHED`、`WECHAT_OFFICIAL_TEMPLATE_PAYSLIP_REMINDER`、`WECHAT_OFFICIAL_REDIRECT_URI`。密钥只写生产环境变量，不进入仓库。

