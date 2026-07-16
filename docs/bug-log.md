# 踩坑记录

## B-001: 摄像头配置多处缓存不同步导致模块间摄像头位置偏移

**日期：** 2026-07-15
**模块：** v2_backend.py, calib_server.py, camera_config.json
**标签：** 配置/逻辑

**症状：** 在设置页（Tab1）扫描摄像头并保存左/中/右配置后，切换到采集页（Tab2）、验证页（Tab4）或主程序的调焦/拍照功能时，使用的摄像头位置与设置的不一致。具体表现：覆盖摄像头 1 看到的是摄像头 0 的画面。

**根因：** `camera_config.json` 被 7 个不同的代码读取点以不同方式处理：
1. `calib_server.py:30` — 全局变量，启动时加载一次，永不过期
2. `calib_server.py:152` — `cap_cb` 中每次读文件（Bug 4 的局部修复）
3. `calib_server.py:182` — 回退路径用全局变量，仍是过期
4. `calib_server.py:127` — `get_cams` 返回全局变量
5. `v2_backend.py:151` — 预览用启动时的 `CAM['center']`
6. `v2_backend.py:190` — 流推送用启动时的 `CAM['center']`
7. `v2_backend.py:292` — 拍照每次读文件

结果：设置页保存正确写入 `camera_config.json`，但只有读取点 2 和 7 能拿到新值，其余 5 个点用的都是启动时缓存的旧值。

**解法：** 重构为底座+模块架构，创建 `src/base/config.py` 作为唯一的摄像头配置入口。`get_camera_config()` 使用 2 秒 TTL 缓存——文件修改后最多 2 秒内所有模块都能读取到最新配置。所有模块（camera_setup、calibration、capture、stream）均通过同一函数获取摄像头索引。

**教训：** 全局配置文件必须有唯一入口点。当多个模块各自维护"启动时加载一次"的缓

## B-002: matching.py 与 v2_backend.py 内联函数重复

**日期：** 2026-07-15
**模块：** v2_backend.py, matching.py
**标签：** 逻辑

**症状：** `match_side()` 和 `match_and_tri()` 两个核心函数出现了两份几乎相同的副本——一份在 `v2_backend.py:52-145`（内联），一份在 `matching.py:28-119`（模块）。v2_backend.py 虽然 `import matching`，但只在 `_do_capture` 中调了一次 `matching.init()`，实际匹配用的是自己的内联副本。

**根因：** V2.21 架构重构时抽取了 `matching.py` 共享模块，但 v2_backend.py 的内联版本未删除。两套代码逐渐分叉（如 v2_backend.py 加了 reference disparity 逻辑），但 matching.py 也同时更新了。

**解法：** 重构中将匹配逻辑统一到 `src/modules/matching/routes.py`，`v2_backend.py` 的内联副本删除。`matching.py` 根目录文件变为兼容性包装，供 `calibrate_chessboard.py` 等诊断工具使用。

**教训：** 抽取共享模块时必须同步删掉旧的内联副本。保留两份代码意味着每修一个 bug 要修两处，必然导致分叉。

## B-003: 部署版 exe/dll 漏拷贝导致验证拍照 1080p、Python 回退分辨率错误

**日期：** 2026-07-15
**模块：** calibration/routes.py, capture/routes.py, build_release.py
**标签：** 配置/部署

**症状：** 部署电脑上 `:5003` 验证页拍一张后距离验证 275x 误差。经排查发现拍摄的图像是 1080p 而非 4K。

**根因：** 初始 robocopy 时排除了 `*.exe` 和 `*.dll` 文件，导致 `capture_three.exe` 不在工作目录中。`cap_cb` 检测到 exe 不存在，回退到 Python 直接调摄像头，但 Python 回退路径用 `open_cam(idx, 1920, 1080)` 只拍了 1080p。

**解法：**
1. 从原项目拷贝 `capture_three.exe`、`stereo_calibrate.exe`、`opencv_world4100.dll` 到工作目录
2. `calibration/routes.py:164` Python 回退路径分辨率从 `1920×1080` 改为 `3840×2160`
3. `capture/routes.py:160-161` 同款修复

**教训：** 打包脚本的排除规则必须仔细审查。Python 回退路径和 C++ 路径的输出必须一致——不能让回退路径降低质量。

## B-004: cv2.findChessboardCorners 角点顺序不一致导致距离验证 275x 误差

**日期：** 2026-07-15
**模块：** calibration/routes.py（detect_corners）, calibration/verify.py（dist_verify）
**标签：** 算法/OpenCV

**症状：** 旧标定帧距离验证正常（10.29mm），新拍帧距离验证 2756.82mm。角点检测通过（289 个），但三角化算出负 Z 值。

**根因：** `cv2.findChessboardCorners` 在不同光照/角度下，可能从棋盘格的不同角落开始数角点。本案例中左摄从左上角开始，中摄从右上角开始，导致索引相同的角点实际上不是同一物理点。dist_verify 用不同物理点做三角化，算出天文距离。

**验证数据：** 旧帧 289/289 个角点满足 `左_x > 中_x`（正确立体几何），新帧仅 241/289 满足。排序后新帧也达到 289/289。

**解法：** 在 `detect_corners()` 末尾增加 `_sort_corners_consistent()`——按空间位置（y 坐标从上到下，每行内按 x 从左到右）重排所有角点，确保索引一致。

**教训：** 立体视觉中不能盲目信任 OpenCV 的角点返回顺序。所有依赖同索引对应同物理点的算法，必须做排序或对应性验证。

## B-005: 浏览器/DShow 摄像头枚举顺序不一致导致预览偏移

**日期：** 2026-07-15
**模块：** calib_app.html, static/v2/app.js, static/app.js
**标签：** 兼容性/浏览器

**症状：** 5003 设置页保存摄像头配置后，采集页实时预览和调焦页预览显示错位的摄像头。5002 主程序预览使用非中摄。

**根因：** 浏览器 `navigator.mediaDevices.enumerateDevices()` 返回的摄像头顺序 ≠ Python DShow `VideoCapture(idx)` 的索引顺序。前端代码用 `cfg.center`（DShow 索引）直接作为浏览器设备数组下标，不做翻译。

**解法：**
1. 后端新增 `GET/POST /api/br_map` 共享存储 DShow→浏览器索引映射（`br_map.json`），serve 模块在:5002 和:5003 都注册
2. 5003 `calib_app.html` Tab1 增加「预览映射」交互——3 个小预览窗口，物理遮罩识别，映射存到 `br_map.json`
3. Tab2 `startLivePreview()` 和 Tab5 `startFocus()` 读 `br_map.json` 做翻译
4. 5002 `static/v2/app.js` 和 `static/app.js` 预览逻辑同步读 `/api/br_map`

**教训：** 浏览器和前端的摄像头抽象层和操作系统的底层 API 之间不存在天然对齐。必须提供跨层映射机制，且映射数据应放在后端共享存储而非 `localStorage`（因为不同端口无法互通）。

## B-006: getUserMedia 未完全释放导致 capture_three.exe 拍照 code=1

**日期：** 2026-07-15
**模块：** static/v2/app.js（capShoot）
**标签：** 兼容性/时序

**症状：** 5002 预览中点击拍照，后端返回 `capture failed(code=1)`。

**根因：** `capShoot()` 调用 `stopPreview()`（停止浏览器 `getUserMedia` 流）后立即 POST `/api/capture`。`MediaStreamTrack.stop()` 是异步的，操作系统需要数百毫秒才能真正释放摄像头句柄。在此之前 `capture_three.exe` 调用 DirectShow 打开摄像头失败，返回 code=1。

**解法：** `stopPreview()` 后增加 `await new Promise(r => setTimeout(r, 1000))`——单摄只需 1 秒（5003 三摄用 2 秒）。

**教训：** 任何涉及操作系统设备句柄释放的异步操作，必须加显式延迟等待。不要假设 API 调用返回设备就立即可用。
