# 优益企服云考勤电子围栏设计

## 目标

在现有考勤打卡链路中增加项目/厂区电子围栏。员工根据当天排班自动匹配项目围栏；围栏外、低精度或定位失败仍允许打卡，但进入异常审核。系统只保存打卡瞬间的位置，不持续追踪员工。

## 数据模型

新增 `attendance_geofences`：`id` BIGINT 主键、`company_id` BIGINT、`project_id` BIGINT、`fence_name` VARCHAR(100)、`latitude` DECIMAL(10,7)、`longitude` DECIMAL(10,7)、`radius_meters` INT、`max_accuracy_meters` INT、`status` TINYINT、`created_by` BIGINT、`created_at` DATETIME、`updated_at` DATETIME。唯一索引 `(company_id, project_id, fence_name)`。

扩展 `attendance_punches`：`geofence_id`、`latitude`、`longitude`、`location_accuracy`、`distance_meters`、`geofence_radius_snapshot`、`geofence_status`、`location_reason`。历史记录保持可解释，不因围栏后续修改而变化。

## 判定规则

- `INSIDE`：定位有效且距离不超过围栏半径。
- `OUTSIDE`：距离超过围栏半径。
- `LOW_ACCURACY`：定位精度大于围栏允许值。
- `LOCATION_FAILED`：拒绝授权、定位超时或设备不可用。
- `NO_FENCE`：排班项目未配置启用围栏，按普通打卡处理并提示 HR。

距离由服务端使用 Haversine 公式计算。客户端只能提交经纬度、精度和失败原因，不得提交距离、围栏 ID 或判定结果。

`OUTSIDE`、`LOW_ACCURACY`、`LOCATION_FAILED` 生成待审核异常；打卡仍参与工时计算。异常审核复用 `attendance_correction_requests`，新增 `GEOFENCE_EXCEPTION` 类型。

## 接口

- `GET /api/attendance/geofences?projectId=`：按数据范围查询围栏。
- `POST /api/attendance/geofences`：`attendance:manage` 创建围栏。
- `PUT /api/attendance/geofences/:id`：`attendance:manage` 修改或停用围栏。
- `POST /api/employee/attendance/punch`：增加 `location`，格式为 `{ latitude, longitude, accuracy }`；定位失败提交 `{ failed: true, reason }`。
- 日报和员工今日接口返回 `geofenceStatus`、`distanceMeters`，普通列表不返回精确坐标。

## 安全与隐私

- 经纬度范围严格校验；精度必须为非负有限数。
- 精确坐标不进入普通列表、导出和薪酬接口。
- 围栏查询和管理沿用项目/员工数据范围。
- 原始位置记录只追加，不允许员工修改。
- Web 和微信小程序在点击打卡时才请求定位，不后台持续定位。
- 第一版不承诺完全识别虚拟定位，仅将异常精度和围栏外位置作为审核证据。

## 页面

HR 考勤工作台增加“电子围栏”视图，按项目配置名称、中心坐标、半径和最大精度。员工打卡页显示定位中、围栏内、围栏外、定位异常状态；围栏外仍可确认提交。

## 验收

- 围栏中心点距离为 0；已知坐标距离误差在 1 米以内。
- 围栏内打卡为 `INSIDE`，围栏外打卡为 `OUTSIDE`。
- 低精度优先标记 `LOW_ACCURACY`。
- 定位失败仍创建打卡并生成待审核异常。
- 客户端伪造距离和围栏状态不会被服务端采用。
- 精确坐标不出现在日报、月报、薪酬汇总和导出。
- 跨企业、跨项目围栏不可读取或修改。

## 上线边界

本次只在本地代码和测试数据库实现验证。生产迁移、微信定位权限声明、隐私政策更新、上传和发布需要另行明确授权。
