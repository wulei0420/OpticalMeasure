# OpticalMeasure V2.30 开发手册

## 1. 项目概述

三摄立体视觉眼镜测量系统。通过三台 4K USB 相机（25° HFOV）拍摄人脸的左/中/右视图，自动检测瞳孔和镜框位置，计算瞳距（PD）、瞳高（PH）、片宽、片高、中梁、前倾角、镜眼距等参数。

### 核心指标

| 指标 | 数值 |
|------|------|
| 拍照分辨率 | 3840×2160（4K） |
| 相机基线 | 总 150mm（左-中 75mm，中-右 75mm） |
| 工作距离 | ~1m |
| 标定板 | 18×18 格，10mm/格，289 内角点 |
| 相机型号 | USB Camera 4k（VID 1BCF PID 0B16） |
| 立体标定质量 | LC RMS 0.36 / CR RMS 0.39 |
| 极线验证 | 平均 1.2px（< 3px 阈值） |
| 距离精度 | 160mm 实测偏差 0.22mm（0.14%） |
| PD 精度 | ~67-68mm（复核后） |
| 支持平台 | Windows PC + iPad Pro (2018+) |

---

## 2. 项目架构

```
镜架参数测量/
├── v2_backend.py          # 主程序后端（Flask, port 5002, 主力）
├── v2_ui.py               # 新UI测试后端（Flask, port 5004）
├── calib_server.py         # 标定&验证后端（Flask, port 5003）
├── matching.py             # 共享匹配+三角化模块
├── db.py                   # SQLite 数据库模块
├── camera_utils.py         # 共享路径+配置模块
├── capture_three.cpp       # C++ 三摄拍照（DirectShow, MJPG 原生）
├── capture_three.exe       # 编译后的拍照工具
├── stereo_calibrate.cpp    # C++ 立体标定（cv::stereoCalibrate, 含离群剔除）
├── stereo_calibrate.exe    # 编译后的标定工具
├── calib_params.json        # 标定结果（K, D, R, T, baseline）
├── camera_config.json       # 相机 DShow 索引映射
├── user_config.json         # PD校正系数
├── om_data.db              # SQLite 客户数据库（自动创建）
├── verify_calib.py          # 自动标定验证脚本
├── build_release.py         # 一键打包脚本
├── start.bat               # 一键启动脚本
├── build.bat               # C++ 编译脚本（VS2022）
├── opencv_sdk/             # OpenCV 4.10 SDK
├── static/
│   ├── v2/                 # 新 UI 单页应用
│   │   ├── index.html      # 五视图入口
│   │   ├── app.css         # 全部样式
│   │   ├── app.js          # 全部逻辑
│   │   └── bg.jpg          # 首页背景图
│   ├── app.html / app.css / app.js  # 旧版 PC 前端（保留）
│   └── calib_app.html/css/js        # 标定前端
├── defaults/               # 模板配置文件
├── tools/                  # 诊断工具归档
├── snapshots/              # 版本快照归档（v220 ~ v228）
├── calib_frames/           # 标定帧 PNG 存储目录
└── customers/              # 客户档案（SQLite 管理）
```

### 进程模型

```
[浏览器] ────HTTP────→ [Python Flask :5002] ──subprocess──→ [capture_three.exe]
                           │                                    │
                           ├── K,R,T 从 calib_params.json       ├── DirectShow 三摄
                           ├── NCC 模板匹配                     ├── MJPG 原生格式
                           └── 三角测量计算 PD                  └── 并行 3 线程拍照

[浏览器] ────HTTP────→ [Python Flask :5003] ──subprocess──→ [stereo_calibrate.exe]
                           │                                    │
                           ├── corner detection                ├── cv::calibrateCamera
                           ├── 逐帧+合并 F 验证                ├── cv::stereoCalibrate
                           └── 极线验证&距离验证                └── JSON 输出 R,T
```

---

## 3. 环境要求

### Python（主程序+标定服务器）
- Python 3.13（**注意：Python 3.13 有已知问题见 §5**）
- Flask, opencv-python==4.13.0.92, numpy>=2

```bash
pip install flask opencv-python numpy
```

### C++ 编译（capture_three.exe + stereo_calibrate.exe）
- Visual Studio 2022 BuildTools
- Windows SDK（DSHOW + MF 支持）
- OpenCV 4.10 SDK（放在 `opencv_sdk/` 目录）
- 编译：运行 `build.bat`

### 浏览器
- Chrome/Edge（支持 getUserMedia 多摄像头）

---

## 4. 工作流

### 4.1 首次设置
1. 插好三个 USB 摄像头
2. 运行 `capture_three.exe --scan` 确认三个摄像头都可见
3. 打开 `http://localhost:5003`，在"摄像头"页扫描并分配左/中/右
4. 保存配置（自动更新 `camera_config.json` + `camera_serials.json`）

### 4.2 标定
1. 打开 `http://localhost:5003` → "采集"页
2. 放置 18×18 棋格板在 ~1m 处
3. 点"实时预览"确认三摄都能看到完整棋格
4. 点"拍照" → 确认 `棋盘格: 检测通过`（绿色）
5. 变换角度（前后倾、左右转、上下移），重复拍 25-32 组
6. 切到"标定"页 → "开始标定"
7. 切到"验证"页 → "加载已有标定帧" → 中摄点瞳孔 → "计算极线" → 在左/右图点瞳孔 → "验证误差"
8. 期望：左摄<30px，右摄<10px

### 4.3 测量
1. 打开 `http://localhost:5002`
2. Prepare → 等待预览出现 → 顾客摆好姿势
3. Capture → 等待 4-5 秒 → 照片显示
4. 跟随提示标注：右瞳孔 → 左瞳孔 → 右框架×4 → 左框架×4
5. Compute → PD/PH 自动计算
6. 可选：复核 → 拖拽修正匹配点 → 复核计算

---

## 5. 关键技术难点 & 解决方案

### 5.1 cv::stereoCalibrate 的 Python 绑定 Bug（核心难点）

**问题**：Python 调用 `cv2.stereoCalibrate()` 在所有 OpenCV 版本的预编译 wheel 中都报错：
```
cameraMatrix1 is not a numpy array, neither a scalar
```

**根因**：Python 3.13 的 CPython API 变更导致 OpenCV 的类型检查失败。降级到 Python 3.11 + OpenCV 4.8 也无效——问题出在预编译 wheel 本身，与 Python 版本无关。C++ 层的 `cv::stereoCalibrate()` 完全正常。

**解决方案**：编写 C++ 程序 `stereo_calibrate.exe`，直接在 C++ 层调用 `cv::stereoCalibrate()`，从 Python 通过 `subprocess.run` 调用。
- 文件：`stereo_calibrate.cpp`（~160 行）
- 输入：`--frames <dir>` 读取 PNG 棋格帧
- 输出：stdout JSON（K, D, R, T, baseline, RMS）
- `calib_server.py` 的 `run_calib` 调用此 exe，解析 JSON，写入 `calib_params.json`

### 5.2 相机串号漂移

**问题**：USB 相机换口或重启后，Windows 分配的 DShow 索引和串号都会变。`--scan` 返回的推荐映射是基于"idx0=center, idx1=left, idx2=right"假设的，但实际物理排列不同。

**解决方案**：
- `camera_config.json`：存 DShow 索引映射（left/center/right → 0/1/2）
- `camera_serials.json`：存串号映射（left/center/right → "USB号"）
- 标定页的 `set_cams` API 在保存时自动运行 `--scan`，将当前索引对应的串号写入 `camera_serials.json`
- 两次配置互相同步，换口后只需在"摄像头"页重新扫描+保存

### 5.3 浏览器和 DShow 的摄像头枚举顺序不同

**问题**：浏览器 `enumerateDevices()` 和 Python DShow `VideoCapture(idx)` 的摄像头顺序不同。

**解决方案**：
- 标定页：`startLivePreview()` 用直接映射 `cams[cfg.left]` 等
- 主程序：`prepare()` 读 `/api/get_cams`，直接用 `cfg.center` 作 `camDevices[]` 索引
- 之前踩过的坑：曾经用 `(pyIdx + 1) % 3` 偏移公式，后来证明不需要，直接映射即可

### 5.4 DirectShow 相机兼容性

**问题**：部分相机（尤其是中心摄像头）不支持 DShow，需要 MSMF；被浏览器 getUserMedia 用过后释放不完全。

**解决方案**：
- `capture_three.cpp`：强制 MJPG 原生格式（避免 RGB24 颜色转换丢色温）
- 流启动后 `pCtrl->Run()` + `Sleep(1500)` 等待相机稳定
- 浏览器预览停止后，1s 等待再拍照（标定页 `captureCB` 和主程序 `capture`）
- MJPG 原生 JPEG 直接保存，不经过 WIC 转码

### 5.5 逐帧 F 矩阵的平面退化

**问题**：单帧棋格只覆盖图像的一小部分区域，从该区域的 289 个共面点估算的 F 矩阵在水区域外完全不准确（外推误差 > 1000px）。

**解决方案**：使用 C++ `cv::stereoCalibrate` 的全局优化——所有帧的角点联合计算 R/T。标定过程中还会缓存逐帧 F 到 `perframe_F.json`，但验证页不再使用逐帧 F（改为从 R/T 算 F）。

### 5.6 匹配视差参数适配 4K

**问题**：匹配代码（`v2_backend.py` 的 `match_side` 函数）的搜索参数原为 1080P 校准的，在 4K 下严重偏小导致视差搜索窗口不对。

**解决方案**（V2.10 已修复）：
```python
# 1080P 旧值 → 4K 新值
base_disp: 345/374 → 731       # FX * BL / Z = 9750 * 75 / 1000
margin:    40      → 100       # 搜索窗口扩大
half:      35      → 70        # 模板大小翻倍（141×141）
```

### 5.7 PD 辐辏校正系数（V2.14）

**问题**：1m 工作距离下双眼存在辐辏（内聚），导致实测 PD 略偏小（约 0.8mm）。镜框是刚性物体，不受此影响（片宽/片高/中梁精度高）。

**解决方案**：
- `user_config.json` 中存 `pd_correction` 系数（默认 1.0）
- `v2_backend.py` 提供 `GET/POST /api/user_config` 端点
- 主程序设置面板可编辑，`updateResults()` 自动乘系数
- 系数 = 验光 PD 值 / 实测 PD 值（例如 65.0/64.2 = 1.012）
- 修改即时生效，无需重启

### 5.8 **永远不要手工修改 calib_params.json（V2.11 血泪教训）** 🔴

**问题**：`stereo_calibrate.exe` 输出的 R 矩阵含微小旋转分量（~0.0016 rad, ~0.09°），T 向量含微小 Y/Z 偏移（~0.14mm, ~2.7mm）。这些不是噪声——是摄像头物理安装精度的真实反映。开发者曾手贱将其覆盖为"完美值"（R=I, T=[±75,0,0]），导致标定失效，此后 8 小时排查全部白费。

**规则**：
1. **永远从 `stereo_calibrate.exe` 的 stdout 直接写入 calib_params.json，不手工修改任何数值**
2. 如果觉得 R≈I 就改成 R=I——那 0.0016 rad 正是支架制造公差的真实量度
3. 如果觉得 T≈[-75,0,0] 就改成完美的 [-75,0,0]——那 0.14mm 的 Y 偏移正是左摄比中摄低 0.14mm 的物理事实

**验证**：改动了 calib_params.json 后，重新跑 `POST /api/verify_epi_auto`，确认每帧极线偏差 < 3px。如果变差，说明手动改错了。

---

## 6. stereo_calibrate.exe 技术细节

### 编译
```batch
cl /EHsc /O2 /MT /Fe:stereo_calibrate.exe stereo_calibrate.cpp ^
   /Iopencv_sdk\include ^
   /link /LIBPATH:opencv_sdk\lib opencv_world4100.lib /SUBSYSTEM:CONSOLE
```

### 输入
- `--frames <dir>`：棋格帧 PNG 目录
- `--pattern 17x17`：内角点行列
- `--square 10`：每格 mm
- `--image-size 3840x2160`

### 输出（stdout JSON）
```json
{
  "ok": true,
  "frames": 32,
  "cameras": [
    {"K": [[fx,0,cx],[0,fy,cy],[0,0,1]], "D": [k1,k2,p1,p2,k3]},
    ...
  ],
  "stereo": [
    {"pair":"left_center", "R":[[...]], "T":[...], "baseline_mm":75.2, "rms":0.2648},
    {"pair":"center_right","R":[[...]], "T":[...], "baseline_mm":75.3, "rms":0.2751}
  ]
}
```

### 标定流程
1. `cv::findChessboardCorners(17x17)` — 282 帧 × 3 摄
2. `cv::calibrateCamera` — 每摄独立（不固定主点）
3. `cv::stereoCalibrate` — CALIB_USE_INTRINSIC_GUESS（允许精调 K）
4. 输出 K/D 含立体优化后的精调值

---

## 7. calib_params.json 字段说明

```json
{
  "version": "1.0",
  "method": "cpp_stereoCalibrate",
  "image_size": [3840, 2160],
  "square_size_mm": 10,
  "num_frames": 32,
  "cameras": [
    {"id": "left",   "K": [[fx,fy,cx],...], "D": [k1,k2,p1,p2,k3]},
    {"id": "center", "K": [...], "D": [...]},
    {"id": "right",  "K": [...], "D": [...]}
  ],
  "stereo": [
    {"pair": "left_center",  "R": [[...]], "T": [-75,0,0], "baseline_mm": 75.0},
    {"pair": "center_right", "R": [[...]], "T": [75,0,0],  "baseline_mm": 75.0}
  ]
}
```

### 字段说明
- **K**：3×3 内参矩阵 `[[fx,0,cx],[0,fy,cy],[0,0,1]]`
- **D**：畸变系数 `[k1,k2,p1,p2,k3]`
- **R**：3×3 旋转矩阵（camA→camB）
- **T**：3×1 平移向量（camB 在 camA 坐标系中的位置，mm）
- **baseline_mm**：基线长度

---

## 8. API 端点速查

### v2_backend.py（主程序, :5002）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 标定加载状态 + 拍照就绪 |
| `/api/get_cams` | GET | 当前相机配置 |
| `/api/capture` | POST | 三摄拍照（调 capture_three.exe） |
| `/api/image/<cam>` | GET | 获取已拍图像 |
| `/api/match` | POST | 单点立体匹配 |
| `/api/tri` | POST | 三点手动三角测量 |

### calib_server.py（标定, :5003）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 服务器状态 |
| `/api/set_cams` | POST | 保存相机配置（自动同步串号） |
| `/api/get_cams` | GET | 当前相机配置 |
| `/api/cap_cb` | POST | 棋盘格拍照 + 角点检测 |
| `/api/run_calib` | POST | 执行标定（调 stereo_calibrate.exe） |
| `/api/existing_capture` | POST | 加载已有标定帧 |
| `/api/epiline` | POST | 计算极线 |
| `/api/epi_error` | POST | 极线偏差计算 |
| `/api/dist_verify` | POST | 距离验证（棋格角点自动） |
| `/api/verify_epi_auto` | POST | 自动极线验证（全帧角点） |

---

## 9. V2.12-V2.14 已解决的限制（已归档）

### 已解决的历史限制
1. ~~**极线偏差**~~ → V2.12 统一 R/T 后降为平均 1.2px（<3px 阈值）
2. ~~**自动匹配精度**~~ → V2.13 三级匹配优化 + V2.14 投影矩阵三角化，PD 稳定 67-68mm
3. ~~**Python cv2.stereoCalibrate**~~ → C++ subprocess 方案永久有效
4. ~~**摄像头串号漂移**~~ → `camera_config.json` + `--left-idx/center-idx/right-idx` 绕过
5. Windows DirectShow 依赖 — 设计约束，不处理

### 已废弃的优化方向
1. ~~**矫正系数重拟合**~~ → V2.14 投影矩阵三角化精度已达 <0.2mm，系数不再需要
2. ~~**自编译 OpenCV**~~ → C++ workaround 足够
3. ~~**仅测瞳距模式**~~ → 标注流程已是 4 步（2 瞳 + 2 框），无需简化
4. ~~**参数面板迁移**~~ → 5002 设置面板已有摄像头参数
5. ~~**深度学习检测**~~ → NCC + 人工修正精度已足够

---

## 10. 继续开发指南

### 接手后的第一件事
1. 阅读此文档的 §5（所有历史坑都总结在这里）
2. 跑一次 `capture_three.exe --scan` 确认相机在线
3. 打开 `http://localhost:5003` 做一次完整标定流程（采集 → 标定 → 验证）
4. 打开 `http://localhost:5002` 做一次完整测量流程

### 修改代码前注意
- **calib_server.py 和 v2_backend.py 两个文件都需要独立运行**——各自的 `/api/get_cams` 读同一个 `camera_config.json`，修改时注意同步
- **build.bat 编译两个 exe**：改动 C++ 代码后运行 build.bat 即可
- **calib_params.json 格式**：§7 有完整的字段说明
- **相机配置同步**：修改 `camera_config.json` 后必须同步更新 `camera_serials.json`（标定页的 `set_cams` API 会自动做）

### 调试技巧
- 主程序标定验证：`POST http://localhost:5003/api/verify_epi_auto` 全自动检查所有帧的极线偏差
- 相机可用性：`capture_three.exe --scan` 快速诊断
- 标定质量：`python -c "print(json.load(open('calib_params.json'))['method'])"` 确认用的是 `cpp_stereoCalibrate`
- 裸眼检查极线：验证页加载一帧，中摄任意点一点，计算极线，看左/右的黄线是否水平、是否穿过对应瞳孔

## 11. iPad + Apple Pencil 移动端 ✅ 已完成

### 目标
在 iPad Safari 上完整运行 5002 主界面，支持 Pencil 精准标注。

### 技术要点
- 新 UI 纯 HTML+JS，Safari 直接运行
- Pencil 走 `PointerEvent` (`pointerType: 'pen'`)，手指触控=拖拽平移，Pencil=标注
- 双指缩放：`touchstart/move/end` 手势驱动 `annScale`
- 强制横屏：CSS `@media(orientation:portrait)` 旋转
- 后端仍需 PC 运行（三摄 USB + Flask）

### 实现细节
- **M1 响应式**: `@media(pointer:coarse)` 44px 触控目标，`user-scalable=no`
- **M2 单帧预览**: 640×360 @25fps，后端线程抓帧 → `/api/stream/center_frame` → 前端 setInterval 40ms 轮询
- **M3 手势**: 单指=拖拽，双指=缩放，Pencil=标注，长按=N/A
- **M4 Pencil**: `pointerType==='pen'` 禁平移，`setPointerCapture` 精准拖拽
- **撤销按钮**: 仅触控设备显示（`@media(pointer:fine){display:none}`）
- **流控**: 拍照/返回首页自动调 `/api/stream/stop` 释放摄像头

### 子任务状态

| ID | 说明 | 状态 |
|----|------|------|
| 11a | PointerEvent 迁移 | ✅ |
| 11b | 触控手势 | ✅ |
| 11c | iPad 布局 | ✅ |
| 11d | Pencil 悬浮 | ✅ |
| 11e | 流预览 | ✅ |

### 兼容性
- iPad Pro 2018 + iPadOS 17 实测通过
- Safari `PointerEvent` + `setPointerCapture` 支持
- `getUserMedia` HTTP 局域网访问正常

---

## 12. 客户档案管理 ✅ 已完成

### 目标
留存每次测量的原始照片和测量结果，可回顾、对比、导出。

### 数据模型
SQLite 双表：
```sql
customers (id, name, phone, notes, created_at)
records (id, customer_id, timestamp, pd, rpd, lpd, right_ph, left_ph,
         frame_width, frame_height, bridge, tilt_angle, vertex_distance,
         front_crop BLOB, side_crop BLOB, result_json)
```

### API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/customers` | GET/POST | 列表搜索 / 新建 |
| `/api/customers/<id>` | GET/PUT/DELETE | 详情 / 编辑 / 删除 |
| `/api/customers/<id>/records` | POST | 保存测量（含 BLOB 图） |
| `/api/customers/<id>/records/<rid>` | GET/DELETE | 加载 / 删除记录 |
| `/api/customers/<id>/records/<rid>/image/<type>` | GET | BLOB 图存取 |

### 前端功能
- **首页搜索**: 姓名/电话搜索 + 无匹配时弹姓名+电话表单新建
- **报告页保存**: 未选客户时弹窗搜或新建，选后自动存 BLOB 标注图
- **历史页**: 客户列表→记录详情+BLOB图+还原+删除客户+删除记录+编辑名称电话
- **自动保存**: 首页选过客户则报告页自动存，按钮隐藏

### 关键设计
- `db.py` 独立模块，SQLite 零外部依赖
- BLOB 存带标注的裁剪图（不存原图），约 80KB/记录
- 测量数据单独存在 `result_json` 中，可重打报告

### 废弃
- JSON 文件存储方式已完全被 SQLite 取代

---

## 13. 侧面拍照 — 前倾角 & 镜眼距 ✅ 已完成

### 拍摄方式
顾客右转 90°，同一三摄架拍摄侧面像。正面和侧面异步处理。

### 可测参数

| 参数 | 定义 | 实现 |
|------|------|------|
| **前倾角** | 镜框上/下缘连线与垂直面的夹角 | 侧面图上两点标注，纯 2D 几何计算 |
| **镜眼距** | 角膜顶点到镜片平面的垂直距离 | 侧面图标注角膜+镜框上下缘 |

### 标注步骤
3 步：镜框上缘 → 镜框下缘 → 角膜顶点。标注页可返回正面微调，侧面标注完成后两步数据合并到同一报告。

### 报告图辅助线
- 橙色镜框线 + 标注点
- 绿色角膜圆
- 蓝白虚线垂直线（穿过镜框下缘）
- 绿色虚线垂距线（角膜→框线）
- 绿色浅虚线平行线（穿角膜平行于框线）
- 前倾角度数文字标注

### 报告页合并
正面和侧面数据在同一报告页展示，侧面参数（前倾角、镜眼距）合入镜架参数表格。

---

## 14. UI 美观度优化 ✅ 已完成（约90%）

### 目标
整体视觉现代化，提升操作舒适度。

### 已实现

| 方向 | 当前状态 |
|------|----------|
| **五视图统一** | 待机/拍照/标注/报告/历史，白底导航栏统一风格 |
| **待机页** | 全屏背景图 + 金色品牌标题 + 毛玻璃搜索框 + 品牌按钮 |
| **拍照页** | 椭圆面部引导遮罩 + 右栏竖排按钮群 + 预览定格动画 |
| **标注页** | DPR 高清画布 + 三层同心圆瞳孔 + 辅助线 + 放大镜 |
| **报告页** | 横版左右分栏 + 瞳孔锚点标注图 + BLOB 图 + 三表面板 |
| **打印** | A4 横版 CSS 优化，间距/字体/图片自适应 |

### 待优化（10%）
- 配色精细化
- 过渡动画
- 报告页元数据排版美化

---

## 15. 架构重构 & 一键部署 ✅ 已完成

### 目标

`OpMeasure.zip` 解压到任意目录，双击 `start.bat`，浏览器打开即可用。新电脑无需安装 Python、OpenCV、pip。

### 完成状态

| 阶段 | 内容 | 状态 |
|------|------|------|
| 15a. 清理 | 删废弃文件（camera_serials.json, cap_one.py, perframe_F.json） | ✅ |
| 15b. 路径统一 | camera_utils.py 统一所有文件 IO | ✅ |
| 15c. 拆前端 | v2_app.html → static/app.html + app.css + app.js | ✅ |
| 15d. 提共享 | camera_utils.py + matching.py + db.py | ✅ |
| 15e. 加验证 | verify_calib.py 自动标定验证 | ✅ |
| 15f. 整后端 | 函数排序、端点规范化 | ✅ |
| 15g. 打包准备 | build_release.py → OpMeasure_v2.xx.zip (~23MB) | ✅ |

### 部署版目录结构

见 §2 项目架构。

---

## 16. 版本历史

| 版本 | 日期 | 里程碑 |
|------|------|--------|
| V2.10 | 基础版 | 初始 5002 三摄测量，1080P 参数 |
| V2.11 | | 恢复真实 R/T，矫正 8 小时手改 bug |
| V2.12 | | 标定 R/T 统一，极线验证 < 3px |
| V2.13 | | 标定离群剔除 + 4K 匹配参数 + 相机配置统一 |
| V2.14 | | 投影矩阵三角化替代视差法，距离精度 0.22mm |
| V2.20 | | 最精确基线：三级匹配优化 + PD 校正系数 |
| V2.21 | | 架构重构：拆前端 + 统路径 + 清冗余 |
| V2.22 | | 侧面测量 + 客户档案 JSON 版 |
| V2.23 | | SQLite 客户管理 + 标注图 BLOB + 历史面板 |
| V2.24 | | 5004 新 UI 五视图 + 放大镜 + 辅助线 |
| V2.25 | | 坐标系统统一 5002（dpr/setTransform/s2p） |
| V2.26 | | 5002 主推新 UI |
| V2.27 | | 客户管理完善（编辑/删除/电话）+ 拍照定格 + 保存修复 |
| V2.28 | | iPad 移动端适配完成 |
| V2.29 | 07.13 | 新支架标定（LC=74.7mm/CR=74.8mm）+ 三摄架构澄清 + 极线/距离双重验证 |
| V2.30 | 07.14 | 自动极线校验（289角点零人工）+ 迭代帧过滤（2.5×中位数）+ 5002热重载P矩阵 + 验证拍照不污染标定池 |

---

## 17. 完成度总览

| 板块 | 子项 | 状态 |
|------|------|------|
| **核心算法** | 标定 / 匹配 / 三角化 / 投影矩阵 | ✅ 100% |
| **PC 端** | 五视图 SPA + 标注 + 辅助线 + 放大镜 | ✅ 100% |
| **iPad 端** | 流预览 + Pencil 标注 + 手势分离 + 强制横屏 | ✅ 100% |
| **客户管理** | SQLite CRUD + BLOB + 编辑/删除 + 历史 | ✅ 100% |
| **侧面测量** | 前倾角 + 镜眼距 + 辅助线 | ✅ 100% |
| **报告页** | 瞳孔锚点裁剪 + 横版分栏 + 打印优化 | ✅ 100% |
| **架构** | matching.py + camera_utils.py + db.py + 一键部署 | ✅ 100% |
| **UI 美观** | 五视图统一风格 + 背景图 + 椭圆遮罩 + 品牌色 | ✅ ~90% |
| **部署** | start.bat + build_release.py + zip 打包 | ✅ 100% |
| **标定质量** | 自动极线校验 + 迭代帧过滤 + 距离验证 | ✅ 100% |

### 待优化（后期）

- UI 最后 10%：配色微调 / 过渡动画 / 报告元数据排版
- PC 端和 iPad 端共用同一套 `static/v2/` 文件，改动即时同步
- 采集端图像质量检查（锐度/角点覆盖率）

### 关键文件速查

| 文件 | 用途 |
|------|------|
| `v2_backend.py` | 主力后端，5002 端口 |
| `static/v2/index.html` | 五视图单页入口 |
| `static/v2/app.js` | 全部前端逻辑（~700 行） |
| `static/v2/app.css` | 全部样式（~120 行） |
| `matching.py` | 立体匹配 + 三角化共享模块 |
| `db.py` | SQLite 数据库 CRUD |
| `camera_utils.py` | 路径 + 配置加载 |
| `capture_three.exe` | C++ DirectShow 三摄拍照 |
| `stereo_calibrate.exe` | C++ 立体标定（含离群剔除） |

---

## 18. 摄像头串号锁死（待实施，需新硬件）

### 背景

当前 USB 摄像头报告的设备名都是 "USB Camera 4k"，无唯一串号。Windows 重启后 DShow 索引可能变化，需要重新在 5003 分配摄像头。如果购买带唯一出厂串号的摄像头，可以永久锁死位置。

### 目标

同一台摄像头无论插哪个 USB 口、无论开机顺序如何，系统始终认出"这是左摄"。

### 方案

#### camera_config.json 结构升级

```json
{
  "left": 0,   "left_serial": "ABC123",
  "center": 1, "center_serial": "DEF456",
  "right": 2,  "right_serial": "GHI789"
}
```

- 有串号 → 拍照时用串号遍历 DShow 设备列表找到对应索引
- 无串号 → 回退到索引（当前行为）
- 两个都配置了 → 串号优先

#### 改动清单

| 层 | 文件 | 内容 | 行数 |
|---|---|---|---|
| C++ 拍照 | `capture_three.cpp` | 新增 `--left-serial/center-serial/right-serial` 参数；scan 时输出串号 | ~30 |
| 后端拍照 | `v2_backend.py` `_do_capture()` | 从 `camera_config.json` 读串号，用串号查 DShow 索引（遍历设备列表匹配） | ~15 |
| 流预览 | `v2_backend.py` `_stream_loop()` | 同上——串号定位中摄索引再打开 | ~5 |
| 标定后端 | `calib_server.py` | scan 时同步保存串号到 `camera_config.json` | ~5 |
| 标定前端 | `calib_app.html` | 摄像头页面显示设备名称+串号，用户一目了然挂哪个摄像头 | ~10 |

#### 不动

- `matching.py`、`db.py`、`camera_utils.py`
- 前端五视图（`static/v2/`）
- 测量和标注全部流程

#### 串号匹配逻辑（伪代码）

```python
def find_camera_index_by_serial(serial):
    # 遍历 DShow 索引 0-9
    for idx in range(10):
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if cap.isOpened():
            # capture_three.exe --scan 输出格式:
            #   idx: 0, name: "USB Camera 4k", serial: "ABC123"
            name = get_device_name(idx)  # 用 capture_three.exe --scan
            if serial in name or serial == get_serial(idx):
                cap.release()
                return idx
        cap.release()
    return None  # fallback to config index
```

#### C++ cli 扩展（capture_three.exe）

```
// 拍照
capture_three.exe --left-serial ABC123 --center-serial DEF456 --right-serial GHI789 --out tmp/ --mode 4k

// 扫描
capture_three.exe --scan
// 输出:
//   0: USB Camera 4k (serial: ABC123)
//   1: USB Camera 4k (serial: DEF456)
//   2: USB Camera 4k (serial: GHI789)
```

### 实施时机

**拿到新摄像头后一次性完成**。当前无串号设备无法测试。完成后编译新的 `capture_three.exe`，配合升级后的 `camera_config.json` 即可永久锁死。

---

## 19. 一键部署方案（待实施）

### 目标

新电脑解压 zip → 双击 → 浏览器打开 → 标定 → 使用。唯一前提：已安装 Python 3。

### start.bat（一键启动）

```batch
@echo off
title OpticalMeasure V2.30
python --version >nul 2>&1 || (echo Python 3 not found! Install from https://python.org && pause && exit /b 1)
python -c "import flask" >nul 2>&1 || pip install flask opencv-python numpy
start "OM-5002" /min python v2_backend.py
start "OM-5003" /min python calib_server.py
timeout /t 3 /nobreak >nul
start http://localhost:5002
echo OpticalMeasure started! Main: http://localhost:5002 Calib: http://localhost:5003
pause >nul
taskkill /f /fi "WINDOWTITLE eq OM-*" >nul 2>&1
```

### 桌面快捷方式（日常用）

| 操作 | 方式 |
|---|---|
| 启动 | 双击桌面 `OpticalMeasure.lnk`（指向 `start.bat`） |
| 停止 | 关掉弹出的黑色命令窗口 |
| 自动启动 | `start_silent.vbs` 放到 `shell:startup` 开机自启 |

### start_silent.vbs（开机自启，无窗口）

```vbs
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "python v2_backend.py", 0, False
WshShell.Run "python calib_server.py", 0, False
```

### 打包后 zip 内容

```
OpMeasure_v2.28.zip (~24MB)
├── README.txt            ← 3步上手
├── start.bat             ← 日常启动
├── start_silent.vbs      ← 开机自启
├── v2_backend.py
├── calib_server.py
├── matching.py / camera_utils.py / db.py
├── verify_calib.py
├── capture_three.exe / stereo_calibrate.exe / opencv_world4100.dll
├── static/v2/ (index.html + app.css + app.js + bg.jpg)
└── defaults/ (camera_config.json + user_config.json)
```

### 新电脑部署步骤

| 步骤 | 操作 |
|---|---|
| 1 | 解压 zip 到任意目录 |
| 2 | 安装 Python 3.11+（勾选 Add to PATH） |
| 3 | 插三摄 USB |
| 4 | 双击 `start.bat` |
| 5 | 打开 `http://localhost:5003` → 摄像头页扫描 → 分配左中右 → 保存 |
| 6 | 标定页采集 30+ 组 → 标定 |
| 7 | 打开 `http://localhost:5002` → 开始测量 |

### 待实施清单

| 项 | 文件 | 行数 |
|---|---|---|
| start.bat 重写 | `start.bat` | ~20 |
| setup.bat 新建 | `setup.bat` | ~15 |
| README.txt 新建 | `README.txt` | ~15 |
| start_silent.vbs 新建 | `start_silent.vbs` | ~5 |
| build_release.py 微调 | 附加 README/setup/silent + 排除 snapshots/tools | ~5 |

总计约 60 行。建议在下次部署前一次性完成。

### opencode 重新部署（开发电脑专用）

将新电脑也变成开发环境——有顾客时工作，没顾客时迭代。

#### 前置条件

| 依赖 | 安装方式 |
|---|---|
| Python 3.11+ | https://python.org → 勾选 "Add to PATH" |
| opencode | 自行安装（CLI 工具） |
| Git（推荐） | https://git-scm.com |

#### 步骤

| 步骤 | 操作 |
|---|---|
| 1 | 在旧电脑上把整个项目文件夹拷贝到新电脑（U 盘或网络共享） |
| 2 | 安装 Python（如已安装跳过） |
| 3 | 安装 opencode（自行处理） |
| 4 | 打开终端，`cd` 到项目目录 |
| 5 | 对 opencode 说：**"检查一下项目环境，缺什么告诉我"** |
| 6 | opencode 检查后告诉你差什么（VS2022 / pip 包 / OpenCV SDK），逐一补齐 |
| 7 | `python start.bat` 跑一次，验证三个端口全开 |

#### opencode 接手后的自检清单（它会逐项查）

| 检查项 | 命令 |
|---|---|
| Python 版本 | `python --version` |
| Flask / OpenCV / Numpy | `python -c "import flask, cv2, numpy"` |
| vs_buildtools | `where cl` 或帮下载 |
| OpenCV SDK | `dir opencv_sdk\include` |
| 摄像头在线 | `capture_three.exe --scan` |
| 标定文件 | `python -c "import json;json.load(open('calib_params.json'))"` |
| 三个服务 | 启动 `start.bat` → 浏览器检查 5002/5003 |

**关键**：opencode 在新电脑上是失忆的——它不知道之前做过什么。只有 `DEVELOPMENT.md` 和这个自查流程能让它快速恢复上下文。不要跳过这个文档，读一遍 §1-§10 再动手。
