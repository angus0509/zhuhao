# Attendance Geofence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为现有考勤打卡增加项目电子围栏判定和异常审核。

**Architecture:** 服务端负责围栏匹配、Haversine 距离计算和状态判定；客户端只在打卡时请求一次定位。异常不阻断打卡，追加审核申请并保留围栏快照。

**Tech Stack:** Node.js、Express、MySQL 8.4、Vanilla JS、原生微信小程序。

**Spec:** `docs/superpowers/specs/2026-09-15-attendance-geofence-design.md`

## Global Constraints

- 不持续定位，不保存轨迹。
- 客户端不得提交距离、围栏 ID 或判定结果。
- 精确坐标不进入普通列表、导出和薪酬接口。
- 围栏外、低精度和定位失败允许打卡，但生成待审核异常。
- SQL 参数化，企业和项目范围严格隔离。

### Task 1: 距离计算核心

- [ ] 新建 `test/attendance-geofence.test.js`，覆盖中心点、已知距离、围栏内外、低精度和失败定位。
- [ ] 运行测试确认失败。
- [ ] 新建 `src/services/attendance-geofence.service.js`，导出 `calculateDistanceMeters` 和 `evaluateGeofence`。
- [ ] 运行测试确认通过并提交。

### Task 2: 数据库迁移

- [ ] 新建 `sql/migrate-attendance-geofence-20260915.mysql.sql`。
- [ ] 创建围栏表并幂等增加打卡位置字段。
- [ ] 新增结构契约测试，确认字段、索引和迁移安全。
- [ ] 在本地测试库执行迁移并只读核验。

### Task 3: 打卡事务集成

- [ ] 写失败测试，覆盖客户端伪造字段、围栏内外和定位失败。
- [ ] 按排班项目加载启用围栏，服务端计算距离并写入快照。
- [ ] 异常时创建 `GEOFENCE_EXCEPTION` 待审核申请。
- [ ] 日报/今日接口仅返回状态和距离。

### Task 4: 围栏管理 API

- [ ] 增加查询、创建、更新/停用接口契约测试。
- [ ] 使用 `attendance:manage` 和项目数据范围保护接口。
- [ ] 验证跨企业和跨项目访问失败。

### Task 5: Web 与微信小程序

- [ ] Web 考勤工作台增加围栏配置视图和打卡定位状态。
- [ ] 微信小程序在点击打卡时调用 `wx.getLocation`，失败时允许异常提交。
- [ ] 不启用后台定位或持续定位权限。
- [ ] 更新页面和小程序契约测试。

### Task 6: 集成验证

- [ ] 运行电子围栏测试、考勤测试、`npm run lint` 和 `npm run check`。
- [ ] 本地启动服务，完成围栏内、围栏外和定位失败三类真实接口联调。
- [ ] 验证日报/月报/薪酬接口不返回精确坐标。
- [ ] 记录已知限制，不执行生产迁移或发布。
