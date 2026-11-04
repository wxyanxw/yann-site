# 本地运行依赖

- Three.js `0.170.0`：`three.module.js`、`OrbitControls.js`，MIT 许可见 `THREE-LICENSE.txt`。OrbitControls 的包导入已改为相对路径，除此之外保持上游内容。
- Pyodide `0.27.7` / Python `3.12.7`：`pyodide/` 包含启动模块、Emscripten glue、WebAssembly、标准库与包索引。许可及第三方声明见 `pyodide/LICENSE`。

资源来自各项目官方发行内容，经 jsDelivr npm/Pyodide 发布镜像下载。固定版本与本地资源避免运行阶段依赖外部 CDN。额外 Python 第三方包没有下载或预装。
