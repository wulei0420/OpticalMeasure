# OpticalMeasure V2.29 — AI 助手接手指南

> **写这个文档的目的**：换一个 AI 助手后，读完这个文档就能接手开发，知道所有坑在哪、每个 bug 怎么修的、每段代码为什么写成这样。

---

## 1. 这个项目是做什么的

三摄立体视觉眼镜测量系统。一台 PC 挂着三台 4K USB 摄像头（间距 75+75=150mm），顾客站在 ~1m 处拍照，系统自动测量瞳距（PD）、瞳高（PH）、镜框尺寸、前倾角、镜眼距。

### 核心数值

| 参数 | 值 |
|------|-----|
| 拍照分辨率 | 3840×2160（4K） |
| 标定板 | 18×18 格，10mm/格，289 内角点 |
| 工作距离 | ~1m |
| 极线误差 | 平均 1.2px（阈值 3px） |
| 距离精度 | 160mm 测偏差 0.22mm（0.14%） |
| PD 精度 | ~67-68mm |

### 关键文件速查

| 文件 | 行数 | 作用 |
|------|------|------|
| `v2_backend.py` | ~460 | Flask 5002，主力后端 |
| `calib_server.py` | ~470 | Flask 5003，标定/验证 |
| `static/v2/app.js` | ~700 | 五视图单页前端 |
| `static/v2/app.css` | ~120 | 全部样式 |
| `static/v2/index.html` | ~110 | 五视图入口 |
| `matching.py` | ~130 | 立体匹配+三角化共享模块 |
| `db.py` | ~140 | SQLite 数据库 CRUD |
| `camera_utils.py` | ~70 | 路径+配置加载 |
| `stereo_calibrate.cpp` | ~230 | C++ 立体标定（含离群剔除） |
| `capture_three.cpp` | ~700 | C++ DirectShow 三摄拍照 |

---

## 2. 全部 Bug 修复记录（按时间顺序）

### Bug 1：Python cv2.stereoCalibrate 崩溃（V2.10）

**现象**：
```
cameraMatrix1 is not a numpy array, neither a scalar
```

**根因**：Python 3.13 的 CPython API 变更导致所有 OpenCV wheel 版本的 `cv2.stereoCalibrate` 类型检查失败。此 Bug 影响所有 opencv-python 版本（4.8-4.13）和所有 Python 版本（3.11-3.14）。

**修复**：编写 C++ 子进程 `stereo_calibrate.exe`，在 C++ 层直接调用 `cv::stereoCalibrate()`，Python 通过 `subprocess.run` 调用。

**教训**：永远不要假设 OpenCV Python binding 可用。C++ subprocess 是确定性的（相同输入 → 相同输出），已验证多次。

---

### Bug 2：R/T 矩阵被人手改为 I/±75mm（V2.11）

**现象**：极线误差 25px，PD 测量 61mm（偏 6mm）。

**根因**：开发者看了一眼 `R_lc ≈ I`（对角线接近 1），手改为精确的 `[[1,0,0],[0,1,0],[0,0,1]]`。那个 0.0016 rad 的微小旋转是摄像头支架制造公差的真实反映——不是噪声。T 向量的 0.14mm Y 偏移也是物理事实（左摄比中摄低 0.14mm）。

**修复**：恢复 C++ exe 输出的原始 R/T 值，永不手改。

**教训**：任何微小数位都是有意义的物理量。`DEVELOPMENT.md §5.8` 已文档化此教训。

---

### Bug 3：标定数据含离群帧导致 stereoCalibrate RMS 爆炸（V2.13）

**现象**：标定 RMS 从 0.27 跳到 253，基线从 75mm 跳到 822mm。

**根因**：34 组棋盘格采集中有 1-2 帧的 `findChessboardCorners` 返回了错误方向的角点（棋盘格在 4 个象限镜像是等价的）。`calibrateCamera` 的 RMS 看不出异常（因为是 34 帧的平均），但 `stereoCalibrate` 把这个单帧错误放大了 1000 倍。

**修复**：在 `stereo_calibrate.cpp` 中增加了逐帧离群剔除——先用 `calibrateCamera` 算每帧的相机外参，用 solvePnP 算两人对相机的相对位置，如果偏离期望基线（75mm）超过 20mm 就删掉该帧。只用内点帧跑 `stereoCalibrate`。

**关键代码**（`stereo_calibrate.cpp`）：
```cpp
// 逐帧计算相对位姿
Rodrigues(rvecs[0][g], R0); Rodrigues(rvecs[1][g], R1);
Mat R_rel = R1 * R0.t();
Mat T_rel = tvecs[1][g] - R_rel * tvecs[0][g];
double bl = norm(T_rel);
// 基线偏差 > 20mm 或 Y/Z 偏 > 30mm → 剔除
if (fabs(bl - 75.0) < 20 && fabs(T_rel.at<double>(1)) < 30 && fabs(T_rel.at<double>(2)) < 30)
    inlier_idx.push_back(g);
```

---

### Bug 4：calib_server.py `/api/cap_cb` 读脏配置（V2.13）

**现象**：5003 摄像头页改完配置后，采集页仍然用旧索引拍照。

**根因**：`calib_server.py` 第 123 行用的全局变量 `cam_config` 是启动时加载的，不随 `camera_config.json` 更新而变。而 `v2_backend.py` 的拍照已改为每次读文件。

**修复**：`/api/cap_cb` 改为每次 `with open('camera_config.json') as f` 读文件。

**教训**：两个后端各自维护相机配置加载逻辑，统一的 `camera_utils.py` 就是为了消除这类 bug。

---

### Bug 5：Pico.css 布局冲突 / Pico.css 失效（V2.24）

**现象**：引入 Pico.css 后界面完全没有变化，后来又发现 Pico.css 的暗色主题不生效。

**根因**：`app.css` 里的 `*{margin:0;padding:0}`、`.btn-p/.btn-s`、`body{background:#0d1117}` 覆盖了 Pico.css 的全部默认样式。同时 `data-theme="dark"` 属性放错了层级——Pico 需要 `<html>` 标签设这个属性，而我们的 CSS 在 body 层级又覆盖了它。

**修复**：删掉 Pico.css 的引用，继续纯手写 CSS。

**教训**：classless 框架（Pico/Water/MVP）是为*内容型页面*设计的，不是为 canvas 驱动型 SPA 设计的。不要往这个项目里引用组件框架，纯手写 CSS 只有 120 行，完全可控。

---

### Bug 6：5004 标注坐标系统与 5002 不同（V2.25）

**现象**：同一个像素位置在 5004 上标注，PD 测量和 5002 偏差 2-3mm。

**根因**：5004 的 canvas 绘制使用了自创的坐标变换（`ctx.translate(annOx*annScale, annOy*annScale) + ctx.scale(annScale, annScale)`），而不是 5002 的 dpr + setTransform 公式。5004 也没有 dpr（devicePixelRatio）处理，在 HiDPI 屏上偏差被放大。

**必须统一的两套公式**：

| | 5002（正确） | 5004 的 V2.24 错误版本 |
|---|---|---|
| **Canvas 尺寸** | `cv.width = r.width * dpr` | `cv.width = cw`（无 dpr） |
| **变换** | `setTransform(scale*dpr, 0, 0, scale*dpr, -ox*scale*dpr, -oy*scale*dpr)` | `translate + scale` |
| **坐标反算** | `s2p: {x: sx/scale+ox, y: sy/scale+oy}` | `annXY: (clientX-r.left)/annScale-annOx` |
| **缩放步进** | `scale *= 1.09 (9%)` | `scale *= 1.1` |

**修复**：完全用 5002 的坐标系统替换 5004 的自造公式。增加了 dpr、s2p/p2s、9% 缩放步进。

**教训**：不要自创坐标变换。这段代码已经是二次犯错了——第一次在 5004 写错了，第二次又修了一次。

---

### Bug 7：`document.getElementById('st')` 不存在（V2.27）

**现象**：报告页点"保存到客户"后弹窗可以选客户，但不保存数据，也没有报错。

**根因**：`scmSelect()` 和 `doSaveToCust()` 中调用了 `document.getElementById('st').textContent`。这是旧 UI 5002 的状态栏元素（`#st`），在 V2.25 新 UI 中已被删除。`getElementById` 返回 `null`，`.textContent=` 抛出 TypeError，但该错误在 `try/catch` 块之外，所以被静默吞掉。

**修复**：删除所有 `document.getElementById('st')` 引用，改为用 `#rptSaveBtn2` 控制保存按钮状态。

**教训**：不要假定 DOM 元素一定存在。`getElementById` 永远加 null 检查。

---

### Bug 8：`setPointerCapture` 阻断 mousemove（V2.28）

**现象**：标注页的放大镜在 iPad 上不跟随鼠标移动。

**根因**：`pointerdown` 中调用了 `e.target.setPointerCapture(e.pointerId)`。在 iPad Safari 上，`setPointerCapture` 捕获全部 pointer 事件，包括 `mousemove`。放大镜监听的是 `mousemove`，在 pointer capture 期间不触发。

**修复**：在 `pointermove` 中增加 magnifier 更新逻辑（因为 `pointermove` 在捕获期间仍然触发）。`mousemove` 只作为桌面端备选。

**教训**：iPad 上 pointer capture 和 mousemove 的行为和桌面端完全不一样。多指+Pencil+Touch 的三方事件流需要额外测试。

---

### Bug 9：BLOB 序列化错误（V2.27）

**现象**：客户列表返回 500 错误，历史页点记录崩溃。

**根因**：Python 的 `db.get_customer()` 返回的 `_record_summary` 把 SQLite BLOB 列也纳入了字典——SQLite 返回的是 `bytes` 类型，`jsonify()` 无法序列化。

**修复**：在 `_record_summary` 中跳过 `front_crop` 和 `side_crop` 列（BLOB 图片独立用 `/image` 端点服务）。同时解析 `result_json` 把 `front_points` 和 `side_points` 提出来放到顶层。

---

### Bug 10：`try/catch` 多余的 `}` 导致 JS 全崩（V2.27）

**现象**：主页按钮全灭。

**根因**：`doComputeAndReport` 中有一段代码：
```javascript
}}catch(e){}
```
`}}` 同时关闭了内层 `if(mr)` 和外层 `try`。但原代码中 `catch` 单独放在下一行前面还多了一个 `}`。编辑时漏掉了一个闭合，深度 -1。

**修复**：压缩为 `...}}catch(e){}` 单行（try→body→}→catch→{} 正确闭合）。

**教训**：改 JS 之后跑一次 Python 括号计数检查：
```python
depth = sum(1 for c in code if c == '{') - sum(1 for c in code if c == '}')
assert depth == 0
```

---

### Bug 11：iPad 流预览 MJPEG 三路炸了（V2.28）

**现象**：iPad 三路 MJPEG 预览掉帧严重，几乎不可用。

**根因**：三个 MJPEG 连接同时占用 WiFi 带宽 + three JPEG encoding streams 跑满 CPU。

**修复**：改为单帧轮询——只输出中摄画面，640×360 @25fps。后端 `_stream_loop()` 循环读帧存内存，前端 `setInterval(40ms)` 轮询单张图片。去掉全部其他摄像头。

**最终参数**：
- 分辨率：640×360
- 帧率：~25fps（`time.sleep(0.04)`）
- JPEG 质量：50
- 总带宽：~200KB/s

---

## 3. 架构关键决策

### 3.1 为什么用 C++ subprocess 而不是全部 Python

Python 的 `cv2.stereoCalibrate` 绑定在 Python 3.13 上崩溃已长期存在。用 C++ 子进程调用：

- 编译一次，永远可用
- 输出 stdout JSON，和 Python 无缝整合
- 加入离群剔除逻辑（Python 做需要额外跑 calibrateCamera 两次）

### 3.2 为什么用 SQLite 而不是 JSON 文件

JSON 文件存储客户记录有两个严重问题：文件系统碎片（每个客户/记录一个文件）+ 搜索需要遍历全目录。SQLite 一个文件解决全部，搜索免费获得 LIKE 支持，备份就是复制一个 `.db` 文件。

### 3.3 为什么五视图是单个 HTML 而非多个页面

五视图之间共享状态（frontPts/sidePts/currentCust），多页面需要 localStorage 或 URL 参数传递状态。单页 SPA 避免了状态同步问题。700 行的 app.js 是紧凑的交错逻辑——不建议拆分。

### 3.4 为什么匹配算法用 NCC 而非深度学习

NCC 模板匹配产生确定性结果。给定相同的摄像头和标定，同一像素位置的匹配结果完全相同。深度学习引入不确定性（模型版本/OPS 优化/GPU 差异），在测量工具中不可接受。

---

## 4. 标识符速查表

### DOM 元素

| id | 所在视图 | 用途 |
|---|---|---|
| `homeSearch` | 首页 | 客户搜索框 |
| `capCanvas` | 拍照页 | 拍照显示 canvas |
| `previewVid` | 拍照页 | PC 端预览 video |
| `prevCenter` | 拍照页 | iPad 预览 img |
| `annotCanvas` | 标注页 | 标注 canvas |
| `annotHint` | 标注页 | 步骤提示文字 |
| `rptBody` | 报告页 | 报告内容容器 |
| `rptSaveBtn2` | 报告页 | 保存到客户按钮 |
| `histBody` | 历史页 | 历史内容容器 |
| `mg` / `mgc` | 标注页 | 放大镜 div/canvas |

### JS 全局变量

| 变量 | 用途 |
|---|---|
| `frontPts / sidePts` | 正/侧面标注点数组 |
| `frontStep / sideStep` | 当前标注步骤 |
| `frontOk / sideOk` | 正/侧面是否已拍照 |
| `currentCust` | 当前选中客户（null=未选） |
| `annScale / annOx / annOy` | 标注画布变换参数 |
| `dpr` | devicePixelRatio |
| `isTouchDevice` | 触控设备检测 |
| `captureStream` | PC 端预览流 |
| `streamTimer` | iPad 预览轮询定时器 |

### Python 模块

| 模块 | 职责 |
|---|---|
| `v2_backend.py` | 5002 全部 API |
| `calib_server.py` | 5003 标定+验证 |
| `matching.py` | `match_side()` + `match_and_tri()` |
| `camera_utils.py` | `path()` / `load_calib()` 等 |
| `db.py` | SQLite CRUD |

### 数据流

```
用户标注瞳孔(cx,cy) → fetch /api/match → 后端 match_and_tri(cx,cy)
  → match_side(cx,cy,'right') → 右摄 NCC 匹配
  → cv2.triangulatePoints(center,right) → 3D坐标(X,Y,Z)
  → 返回 p3d ← 前端计算 |p3d_L - p3d_R| = PD
```

---

## 5. 已知限制

1. **摄像头串号**：当前 USB 摄像头无唯一串号，换 USB 口/重启后索引可能变化。物理贴标签+固定端口是临时方案，长期需买带串号的摄像头（§18 已规划）。

2. **iOS 限制**：iPad Safari 不支持 `getUserMedia` 同时访问多个摄像头，只能单路流预览。

3. **平台依赖**：DirectShow + MSVC 编译 → Windows 专用。Linux/Mac 需要在 C++ 编译时替换 V4L2/AVFoundation。

4. **校准参数绑物理支架**：每套支架需独立标定。拷贝 `calib_params.json` 到另一套支架上无效。

5. **浏览器兼容**：Chrome / Edge / Safari 15+ 通过。Firefox 未测试。

6. **Python 3.13**：**不要降级**——`cv2.stereoCalibrate` 这个 bug 在所有 Python 版本都存在，和 Python 版本无关。用 C++ subprocess。

---

## 6. 继续开发注意事项

### 6.1 修改任何代码前先做

1. 读本文档全文 + `DEVELOPMENT.md §5`（历史坑总结）
2. 跑一次 `python verify_calib.py` 确认标定参数正常
3. 改完之后刷新 PC 端 + iPad 端两个环境全流程

### 6.2 不要做的事

| 禁止 | 原因 |
|------|------|
| 手改 `calib_params.json` | Bug 2 的血泪教训 |
| 引入组件库（Pico/Tailwind） | Bug 5 证明不适 |
| 用 Python cv2.stereoCalibrate | Bug 1——确定性的崩溃 |
| 拆分 app.js 成多个文件 | 共享状态过多，拆分会引入更多 bug |
| 在没有 `git commit` 的情况下重构 | 回退成本巨大 |

### 6.3 推荐做的事

| 建议 | 效果 |
|------|------|
| 改 JS 后跑 `python -c "depth=sum(1 for c in open('static/v2/app.js').read() if c=='{')-sum(1 for c in open('static/v2/app.js').read() if c=='}');assert depth==0"` | 防止 Bug 10 重演 |
| CSS 改动只加不删 | 避免破坏现有布局 |
| 新功能先上 5004 验证再合入 5002 | 隔离风险 |

---

## 7. 关键页面路由

| 页面 | URL | 后端 |
|------|-----|------|
| 主程序新 UI | `:5002` | `v2_backend.py` |
| 主程序旧版（保留） | `:5002/static/app.html` | `v2_backend.py` |
| 标定页面 | `:5003` | `calib_server.py` |

---

## 8. 版本历史

| 版本 | 里程碑 |
|------|--------|
| V2.10 | 基础三摄测量 |
| V2.11 | 恢复真实 R/T |
| V2.12 | R/T 统一 |
| V2.13 | 离群剔除 |
| V2.14 | 投影矩阵三角化 |
| V2.20 | 三级匹配优化 |
| V2.21 | 架构重构（拆前端+统路径） |
| V2.22 | 侧面测量+客户档案 |
| V2.23 | SQLite+BLOB |
| V2.24 | 新 UI 五视图 |
| V2.25 | 坐标系统统一 |
| V2.26 | 5002 主推新 UI |
| V2.27 | 客户管理完善+拍照定格 |
| V2.28 | iPad 移动端适配 |
| V2.29 | 清理收尾+文档补全+GitHub 上线 |

---

## 9. 部署新电脑

见 `DEVELOPMENT.md §19`。

---

## 10. 仓库

https://github.com/wulei0420/OpticalMeasure

`opencv_world4100.dll` 在 Releases → v2.29 资产中。clone 后下载放到项目根目录。

---

*本文档最后更新：2026-07-14，V2.29*
