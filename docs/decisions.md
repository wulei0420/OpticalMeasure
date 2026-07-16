# 决策日志

## D-001: 从单体架构重构为底座+模块架构

**日期：** 2026-07-15
**状态：** 通过

**背景：** 原项目 V2.30 是一个单体 Flask 双服务器架构，`v2_backend.py`（490行）和 `calib_server.py`（606行）各自包含路由、业务逻辑、配置加载、相机控制等全部代码。关键 bug：摄像头配置文件 `camera_config.json` 被 7 处不同代码以不同方式读取（有的启动时缓存永不过期、有的每次读文件），导致设置页保存后其他页面（采集/验证/调焦）使用的仍是旧配置。

**决策：** 采用底座+模块架构重构 Python 后端：
- `src/base/` — 底座层（配置管理、Flask 应用工厂、错误处理、模块间状态通信）
- `src/modules/camera_config/` — 摄像头设置（扫描、分配左中右、保存配置）
- `src/modules/calibration/` — 标定+验证（棋盘格采集、C++立体标定、极线/距离验证）
- `src/modules/capture/` — 拍照（正面/侧面，C++ exe 或 Python 回退）
- `src/modules/matching/` — NCC 立体匹配+三角化
- `src/modules/measurement/` — 测量（PD/PH、前倾角、镜眼距、用户配置）
- `src/modules/customer/` — 客户管理（SQLite CRUD）
- `src/modules/stream/` — iPad 流预览
- `src/modules/serve/` — 静态文件+状态+反馈

**后果：**
- 好处：摄像头配置统一通过 `src/base/config.py` 的 `get_camera_config()` 读取，2 秒 TTL 缓存保证既不会读到过期配置又不影响性能。所有模块通过底座共享状态（`set_state/get_state`）而非互相导入。
- 代价：增加了目录层级和文件数量（从 5 个核心 Python 文件变为 20+ 个模块文件）。C++ exe 和前端 JS/HTML 不变。
- 替代方案：不做架构重构，只修 bug（在所有读取点都加文件重读）。放弃原因：治标不治本，类似 bug 反复出现（AI_HANDOFF.md 记录的 Bug 4、Bug 3 本质上都是配置管理混乱的后果）。

## D-002: 前端和 C++ 不做重构

**日期：** 2026-07-15
**状态：** 通过

**背景：** 前端 `app.js`（700行）包含五视图的全部交互逻辑，状态高度耦合，AI_HANDOFF.md 明确标注"不建议拆分"。C++ `capture_three.exe` 和 `stereo_calibrate.exe` 是编译产物，接口稳定。

**决策：** 本次重构只动 Python 后端代码。前端 JS/HTML/CSS 和 C++ exe 源码不动。

**后果：**
- 好处：风险可控，前端功能完全不退化。重构范围锁在 ~800 行 Python 代码。
- 代价：前端代码仍为单体文件，不满足底座+模块文件规模约束。但已有决策记录 D-001 记录后端重构，前端作为例外不在本次范围。
- 替代方案：同时拆分前端 app.js。放弃原因：AI_HANDOFF.md 记录了"700行的app.js是紧凑的交错逻辑——不建议拆分"的血泪教训。

## D-003: 模块间通信使用 base 共享状态而非 Flask g/current_app

**日期：** 2026-07-15
**状态：** 通过

**背景：** 模块间需要共享状态（如拍照后的图像数据、标定帧数据），旧代码使用全局变量。Flask 原生支持 `g` 和 `current_app.config`，但 `g` 仅生命周期为一个请求，不适合跨请求共享图像。

**决策：** 使用 `src/base/` 的 `set_state(key, value)` / `get_state(key)` 作为线程安全的模块间通信机制。本质是一个带锁的进程级字典。

**后果：**
- 好处：简单直接，不需要引入 Redis 或消息队列（对单机桌面应用来说过度设计）。模块间解耦——capture 模块设置 `captured_front`，matching 模块读取同一 key，双方互不 import。
- 代价：状态不持久化（进程重启丢失），但对于运行中的测量会话是足够的。需要约定 key 命名避免冲突。
- 替代方案：使用 Flask `current_app.config`。放弃原因：模块间需要通过约定的 key 通信，`current_app.config` 与具体 Flask 实例绑定，不利于模块独立测试。

## D-004: brMap（DShow↔浏览器摄像头映射）从前端 localStorage 迁移到后端共享文件

**日期：** 2026-07-15
**状态：** 通过

**背景：** 浏览器 `navigator.mediaDevices.enumerateDevices()` 返回的摄像头顺序与 Python DirectShow `VideoCapture(idx)` 的索引顺序不同。预览需要用浏览器 API 打开正确物理摄像头，必须做 DShow→浏览器索引映射。初始方案将映射存在浏览器 `localStorage` 中，但 `localStorage` 按域名+端口隔离——`:5002` 和 `:5003` 各有独立存储，需分别在两个页面各设一次。

**决策：** 映射改为后端存储：
- 后端 `src/modules/serve/routes.py` 新增 `GET/POST /api/br_map`，读写项目根目录 `br_map.json`
- 所有前端（5003 Tab1/Tab2/Tab5、5002 app.js）统一调用此 API
- 5003 Tab1 设置界面提供「预览映射」交互（三个小预览窗口 + 物理遮罩识别）

**后果：**
- 好处：一次设置全局生效。5002 和 5003 自动同步，不需要重复配置。`br_map.json` 随项目文件一起备份/部署。
- 代价：增加了一个小的状态文件和一个 API 端点。前端需要额外一次 fetch 调用来加载映射。
- 替代方案：保留 `localStorage` 但让用户手动在两个端口各设一次。放弃原因：违背"一次设置管全局"的核心重构目标。

## D-005: 棋盘格角点检测后强制按空间位置重排序

**日期：** 2026-07-15
**状态：** 通过

**背景：** `cv2.findChessboardCorners()` 在不同光照/角度下可能从棋盘格的不同角落开始数角点。当三台摄像头的视角差异导致 OpenCV 的内部方向检测产生分歧时，索引 i 的角点在各视图中可能对应不同的物理点。距离验证（`dist_verify`）和极线验证（`epi_verify_auto`）等依赖同索引对应同物理点的算法会算出错误结果。

**决策：** 在 `detect_corners()` 函数末尾增加 `_sort_corners_consistent()` 排序步骤：按角点 y 坐标分组为行（从上到下），每行内按 x 坐标排序（从左到右）。始终返回一致的网格顺序，不依赖 OpenCV 的初始排序。

**后果：**
- 好处：完全消除了角点顺序不确定性。验证精度从 275x 误差恢复到 < 2%。实现简单（~15 行代码），不依赖额外库。
- 代价：排序假设棋盘格大致水平放置。如果棋盘格旋转 > 45°，排序规则可能不适用（但实际使用场景中棋盘格始终接近水平）。
- 替代方案：使用 PCA 确定主轴方向后排序。放弃原因：对实际使用场景过度复杂，简单 y/x 排序已验证有效。

