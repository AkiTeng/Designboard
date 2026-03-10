# 开发计划（Implementation Plan v0）

## 1. 当前结论

基于 `docs/prd-draft.md` 和 `docs/technical-framework-draft.md`，第一阶段直接收敛为：

- 宿主：浏览器优先
- 前端：React
- 主画布：PixiJS
- 持久化：浏览器存储优先，后续接原生文件系统
- 优先平台：桌面端

当前仓库还没有实际业务代码，只有文档，因此第一步不是优化架构，而是先搭出可运行骨架，并尽快跑通“输入 Prompt -> 调用 provider -> 落盘 -> 回填到画布”主路径。

补充约束：

- 当前阶段以浏览器运行作为第一优先
- 后续代码结构必须保留以 SwiftUI + WKWebView 封装 macOS App 的可迁移性
- 这意味着宿主层能力必须通过 adapter / bridge 注入，不能直接散落到 React UI 和编辑器核心里

## 2. MVP 代码目标

第一批代码只解决以下问题：

1. 能启动一个桌面应用壳
2. 能打开一个 PixiJS 画布并完成平移缩放
3. 能在本地创建项目和画布目录
4. 能保存并重新打开最小画布文档
5. 能接一个 provider mock，返回图片结果并写入本地
6. 能把结果以图片节点形式回填到画布

第一阶段暂不实现：

- 移动端
- 多 provider 真接入
- designDraft 节点完整能力
- effect runtime
- 回收桶恢复
- 复杂撤销重做

当前 provider 路线补充：

- 浏览器阶段先保留 `mockProvider`
- 第一批真实接入优先支持 `OpenRouter`
- provider 配置先收口到独立设置层，不能直接散落在 React 组件里

## 3. 实施顺序

### Milestone 0：浏览器工程初始化

目标：把工程跑起来。

建议落地：

- 初始化浏览器端 React 工程
- 接入 TypeScript、ESLint、基础格式化
- 定好目录：

```text
src/
  app/
  features/
    canvas/
      ui/
      editor/
      renderer/
      assets/
      shared/
    generation/
    projects/
    settings/
```

验收：

- `npm run dev` 可启动
- 页面中有空白编辑器壳层

### Milestone 1：画布最小运行时

目标：先把桌面核心交互站住。

建议落地：

- 建立 `CanvasEditor` 管理 camera、nodes、selection
- 建立 `PixiCanvasApp` 挂载 PixiJS application
- 先支持：
  - 空画布渲染
  - 鼠标拖动画布
  - 滚轮 / 触控板缩放
  - 单节点图片渲染
- 节点模型先只实现 `image`

验收：

- 能加载一个内存中的 `CanvasDocument`
- 能看到图片节点
- 缩放和平移正常

### Milestone 2：本地持久化

目标：把“画布可恢复”做出来。

建议落地：

- 先用浏览器存储跑通持久化协议，再保持与未来原生文件结构一致：

```text
workspace/
  projects/
    <project-id>/
      project.json
      canvases/
        <canvas-id>/
          canvas.json
          assets/
            original/
            preview/
            thumbnail/
          trash/
```

- 实现项目创建、画布创建、画布保存、画布读取
- `canvas.json` 只保存持久化状态，不保存 Pixi runtime 状态
- 原生文件系统读写作为后续宿主能力接入，不阻塞浏览器版主路径开发

验收：

- 新建项目后落盘
- 重新打开应用可恢复已有项目和画布

### Milestone 3：生成链路最小闭环

目标：把产品主路径跑通。

建议落地：

- 建立统一 provider 接口：
  - `generateImages(input): Promise<GenerateResult>`
- 先实现 `mockProvider`
- 建立生成任务状态：
  - `idle`
  - `running`
  - `success`
  - `error`
- 生成返回后执行：
  - 保存原图
  - 生成 preview / thumbnail
  - 更新 asset 索引
  - 创建 image node

验收：

- 输入 Prompt 后可以生成 mock 结果
- 结果会落盘并回填到当前画布

### Milestone 4：资源等级与基础性能

目标：避免后续一开始就走错。

建议落地：

- 建立 `AssetManager`
- 默认画布只吃 `thumbnail` / `preview`
- 视区外节点不加载高等级纹理
- 相机交互时暂停高成本资源升级

验收：

- 同一画布放入 30-50 张图时仍可基本拖拽和缩放
- 资源加载不会阻塞主交互

### Milestone 5：编辑器基础能力补齐

目标：从“能跑”变成“能用”。

建议落地：

- 多选
- 框选
- 删除到 trash
- 基础 undo/redo
- provider 设置页

## 4. 首批文件设计

建议第一批直接创建这些核心文件：

```text
src/features/canvas/shared/types.ts
src/features/canvas/editor/CanvasEditor.ts
src/features/canvas/renderer/PixiCanvasApp.ts
src/features/canvas/renderer/RendererRegistry.ts
src/features/canvas/renderer/renderers/ImageNodeRenderer.ts
src/features/canvas/assets/AssetManager.ts
src/features/projects/storage/FileSystemRepository.ts
src/features/generation/providers/types.ts
src/features/generation/providers/mockProvider.ts
src/features/generation/application/GenerationService.ts
```

## 5. 先定的数据模型

第一批不需要把 schema 做复杂，但这几个类型必须先定：

- `Project`
- `CanvasDocument`
- `CanvasNode`
- `ImageNode`
- `ImageAsset`
- `PromptRecord`
- `ProviderConfig`

建议约束：

- `CanvasNode` 持久化层不保存运行时对象引用
- `ImageAsset` 必须显式区分 `thumbnailPath`、`previewPath`、`originalPath`
- `CanvasDocument` 必须包含 `camera`

### 5.1 参考 tldraw 的状态分层

这里建议直接借鉴 tldraw 的核心思路：`store + editor + instance state`，但做适合 Designboard 的收敛版。

建议拆成 4 层：

- `Document Store`
  - 只保存可持久化 JSON 记录
  - 包含 `Project`、`CanvasDocument`、`CanvasNode`、`ImageAsset`、`PromptRecord`
- `Editor Runtime`
  - 负责命令入口和事务
  - 负责增删改节点、相机变更、选择、删除、撤销重做
- `Canvas Instance State`
  - 当前工具
  - 当前选中节点
  - 当前 hover
  - 当前视口状态
  - 当前交互态，如 dragging / panning / selecting
- `Renderer Runtime`
  - Pixi 对象引用
  - 纹理缓存
  - 可见性结果
  - dirty 区域

在这 4 层之外，再额外保留一层 `Host Bridge`：

- 文件系统
- 窗口能力
- 系统菜单
- 原生快捷键
- 原生对话框

第一版即使暂时只接浏览器 / Tauri，也不能把这些能力直接写死在 React 组件里，因为后续 SwiftUI 封装时需要替换这层宿主桥接。

这样分层的目的，是避免把 Pixi 对象、临时交互状态和持久化文档写进同一套 store。

### 5.2 第一版核心实体建议

参考 tldraw 的 `records` 模型，第一版建议所有持久化对象都走统一 record 风格：

```ts
type RecordBase = {
  id: string
  typeName: string
}
```

建议至少有：

- `project`
- `canvas`
- `node`
- `asset`
- `prompt`
- `providerConfig`

其中：

- `node` 负责画布内容
- `asset` 负责原图 / preview / thumbnail
- `prompt` 负责生成来源追踪

### 5.3 第一版状态流转建议

参考 tldraw，所有文档修改都不要散落在 React 组件里，而是统一经过 `CanvasEditor` 命令层。

建议主路径统一为：

1. UI 发出命令
2. `CanvasEditor` 在一次事务内更新 `Document Store`
3. `Renderer Runtime` 订阅变更并局部刷新
4. `Persistence` 异步把快照写入文件系统

例如“生成图片成功”的状态流转：

1. `GenerationService` 返回结果
2. `AssetManager` 写入原图和缩略图
3. `CanvasEditor.insertImageNodes()` 原子写入 `asset record + node record + prompt record`
4. `Renderer Runtime` 收到增量变更后创建 Pixi sprite
5. `FileSystemRepository` 持久化最新快照

第一版建议引入两个硬约束：

- 所有文档级修改都必须通过 editor command / transaction
- React 组件不能直接改 document records

## 6. 当前阻塞与假设

开始写代码前，还缺 4 个决定：

1. 浏览器版是否作为唯一当前运行目标；已确认是
2. React 用 Vite 还是 Next.js；按当前目标更建议 Vite
3. 第一版 provider 是否只先接 mock，再接真实服务商；建议是
4. 工作区根目录是否就是单一项目容器；已确认当前工作区就是独立的一单项目工作区

补充已确认方向：

- 后续需要保留 SwiftUI 封装 macOS App 的路径
- 因此当前实现不把任何桌面宿主当成业务层依赖，而只把它们当成可替换宿主实现

## 7. 建议的开工顺序

如果现在直接开写，建议严格按下面顺序：

1. 初始化 `Tauri + React + TypeScript`
2. 先做空编辑器壳和 PixiJS 画布挂载
3. 定义 `types.ts`
4. 写 `CanvasEditor`
5. 写 `PixiCanvasApp`
6. 接本地 `FileSystemRepository`
7. 接 `mockProvider`
8. 跑通生成闭环

## 8. 下一步

下一步最合理的动作不是继续写文档，而是直接初始化工程，并先把 Milestone 0 和 Milestone 1 做掉。
