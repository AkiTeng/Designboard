# PixiJS 画布开发文档（PixiJS Development Guide v0）

## 1. 文档目标

本文件用于把 `docs/technical-framework-draft.md` 中已经确认的方向，进一步细化为可开发、可拆分、可验收的 PixiJS 落地方案。

适用范围：

- 桌面端无限画布主工作区
- 图片节点、设计稿节点、effect 节点统一运行时
- 多张大图与有限数量 shader 同屏的渲染与交互
- React UI 壳层与 PixiJS 渲染层协同

不包含：

- 复杂协同编辑
- 完整矢量编辑器
- 实时 GLSL 编辑器
- 服务端架构设计

## 2. 目标结论

当前方案收敛为：

- UI 框架：React
- 主画布渲染：PixiJS
- 宿主形态：优先 Tauri + Web
- 状态分层：UI Store + Editor Runtime + Renderer Runtime
- 默认资源策略：`thumbnail -> preview -> original`
- 默认 shader 策略：受控 effect runtime，不作为首版主路径编辑能力

核心判断：

- PixiJS 可以承担大图、缩放、平移、分层渲染和 shader/filter 基础能力
- Figma 类流程中的编辑器能力需要自行实现，不能指望 PixiJS 直接提供
- 第一版必须优先保证交互流畅和资源可控，而不是追求 effect 能力上限

## 3. 总体架构

建议拆成 5 层：

### 3.1 Shell Layer

负责 React UI：

- 顶部工具栏
- 左右侧面板
- 资源列表
- 属性面板
- 底部状态栏
- 输入框和生成任务面板

约束：

- React 不直接渲染画布节点
- React 不保存 Pixi DisplayObject 引用
- React 通过命令和订阅与 editor runtime 通信

### 3.2 Editor Runtime

负责编辑器语义：

- 当前工具状态
- 选中、多选、框选
- 节点增删改
- 撤销重做
- 对齐线、吸附、锁定、隐藏
- 视口状态 camera
- 文档读写

约束：

- 不直接依赖 React 生命周期
- 不直接持有具体 UI 组件
- 不把 Pixi 对象作为持久化模型的一部分

### 3.3 Renderer Runtime

负责 PixiJS 场景管理：

- `PIXI.Application`
- scene graph 映射
- layer 容器
- 节点 renderer 注册和分发
- dirty 区域和刷新调度
- viewport 裁剪
- hit test 辅助

约束：

- renderer runtime 只消费 editor runtime 产出的标准化节点数据
- 每种节点类型单独注册 renderer
- effect 渲染不得直接侵入 image renderer 主路径

### 3.4 Asset Runtime

负责资源生命周期：

- 图片解码
- 缩略图选择
- 纹理加载
- 纹理引用计数
- 纹理预算控制
- LRU 释放
- 交互态与静止态资源升级

### 3.5 Effect Runtime

负责 shader 和 effect：

- shader 编译
- uniform 更新
- render texture 分配
- effect pass 调度
- effect 降级

约束：

- effect 节点可被整体关闭
- effect 失败不能拖垮主画布
- 交互态允许暂停动画和高成本 pass

## 4. 目录建议

建议前端目录按以下方式组织：

```text
src/
  app/
  features/
    canvas/
      ui/
      editor/
      renderer/
      assets/
      effects/
      shared/
```

建议进一步细分：

```text
src/features/canvas/
  ui/
    CanvasShell.tsx
    CanvasToolbar.tsx
    InspectorPanel.tsx
  editor/
    CanvasEditor.ts
    commands/
    history/
    selection/
    transforms/
    snapping/
  renderer/
    PixiCanvasApp.ts
    SceneGraph.ts
    RendererRegistry.ts
    layers/
    renderers/
      image/
      designDraft/
      effect/
  assets/
    AssetManager.ts
    TextureCache.ts
    DecodeQueue.ts
    ResourceLevelPolicy.ts
  effects/
    EffectManager.ts
    ShaderRegistry.ts
    passes/
  shared/
    types.ts
    geometry.ts
    constants.ts
```

## 5. 运行时数据模型

### 5.1 持久化模型

```ts
type CanvasDocument = {
  id: string
  name: string
  camera: CameraState
  nodes: CanvasNode[]
  assets: Record<string, ImageAsset>
}

type CameraState = {
  x: number
  y: number
  zoom: number
}

type CanvasNode =
  | ImageNode
  | DesignDraftNode
  | EffectNode

type BaseNode = {
  id: string
  type: 'image' | 'designDraft' | 'effect'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  locked?: boolean
  hidden?: boolean
}

type ImageNode = BaseNode & {
  type: 'image'
  assetId: string
  renderMode: 'cover' | 'contain' | 'stretch'
}

type DesignDraftNode = BaseNode & {
  type: 'designDraft'
  snapshotAssetId?: string
  draftData: Record<string, unknown>
}

type EffectNode = BaseNode & {
  type: 'effect'
  effectType: string
  effectConfig: Record<string, unknown>
}

type ImageAsset = {
  id: string
  width: number
  height: number
  thumbnailPath: string
  previewPath: string
  originalPath: string
  estimatedTextureBytes?: number
}
```

### 5.2 运行时模型

```ts
type SceneNodeRuntime = {
  nodeId: string
  bounds: Bounds
  visible: boolean
  dirty: boolean
  resourceLevel: 'thumbnail' | 'preview' | 'original'
  lastUsedAt: number
  estimatedGpuBytes: number
}
```

原则：

- 持久化对象与 Pixi DisplayObject 分离
- 运行时状态允许重建
- 资源等级是运行时决策，不应写死在文档数据里

## 6. PixiJS 场景分层

建议至少拆成以下容器层：

1. background layer
2. content layer
3. effect layer
4. overlay layer
5. interaction layer

对应职责：

- background：网格、背景色、辅助底图
- content：图片节点、设计稿快照
- effect：独立 effect 节点或节点附属效果
- overlay：选框、对齐线、hover outline
- interaction：拖拽锚点、临时预览、框选矩形

约束：

- overlay 和 interaction 不参与导出
- effect layer 可以整体降级、隐藏或暂停
- 选中态不要回写进节点图层本身，避免污染内容层渲染

## 7. 节点渲染器设计

建议使用 renderer 注册表：

```ts
type NodeRenderer = {
  mount(node: CanvasNode): void
  update(node: CanvasNode): void
  unmount(nodeId: string): void
  hitTest(point: Point): HitResult | null
}
```

最少实现以下 3 类 renderer：

### 7.1 ImageRenderer

职责：

- 管理 Sprite 或 Mesh
- 根据 zoom 和可见性选择资源等级
- 处理基础裁剪、透明度、旋转

要求：

- 默认只上 preview 纹理
- 高速缩放时锁定低等级资源
- 停止交互后再尝试升级 original

### 7.2 DesignDraftRenderer

职责：

- 第一版优先渲染静态快照
- 后续再扩展内部层级

要求：

- 不在首版做每帧复杂排版
- 优先使用缓存纹理

### 7.3 EffectRenderer

职责：

- 创建 filter 或 render texture pass
- 更新 uniforms
- 控制 effect 节点生命周期

要求：

- 单个 effect 的失败不影响主场景
- 交互态可以挂起 effect 动画
- effect 过多时允许只保留可见区域节点

## 8. 视口与交互模型

建议统一使用 camera 模型：

```ts
type CameraState = {
  x: number
  y: number
  zoom: number
}
```

交互规则：

- 滚轮或触控板缩放作用于 camera.zoom
- 平移作用于 camera.x / camera.y
- 节点坐标始终使用世界坐标
- 所有命中检测先把屏幕坐标转换到世界坐标

建议最少支持：

- 平移
- 滚轮缩放
- 框选
- 多选
- 拖拽移动
- 缩放控制手柄
- 基础吸附

工程建议：

- 不在 React 事件里直接处理复杂拖拽状态
- 指针事件先进入 canvas controller，再转给 editor runtime
- 缩放过程优先保帧率，不同步触发属性面板重算

## 9. 资源管理策略

### 9.1 资源等级

- `thumbnail`：远景、概览、快速缩放
- `preview`：默认工作态
- `original`：静止态、导出态、全屏查看

### 9.2 加载原则

- 新打开画布时先加载视区内 thumbnail 或 preview
- 交互过程中只允许轻量升级，不允许阻塞式原图加载
- 停止交互后按视区中心优先级逐步升级资源

### 9.3 释放原则

- 节点移出视区后可释放 original
- 超出显存预算时优先回收 original，再回收 preview
- 同一资源被多个节点引用时基于引用计数管理

### 9.4 预算建议

- 首版先定义静态预算，例如 256 MB 到 512 MB 的纹理预算区间
- 预算命中后必须触发可观测日志
- effect 离屏纹理要单独计入预算

## 10. shader / effect 策略

第一版策略：

- 只支持预定义 effect
- 不支持用户自由编写 GLSL
- 每类 effect 需要有明确成本评级

建议把 effect 分 3 档：

- L1：基础滤镜，如 blur、color shift、noise overlay
- L2：单 pass 动态效果
- L3：多 pass 或高分辨率依赖效果

调度原则：

- 交互态暂停 L3
- 超预算时关闭不可见 effect
- context 丢失后先恢复 content layer，再恢复 effect

## 11. 性能策略

### 11.1 必做

- viewport culling
- 空间索引
- 交互态降级
- 静止态回补
- 纹理预算和 LRU
- effect 隔离
- 指标采集

### 11.2 明确不做

- 首版不做无限制原图同屏
- 首版不做复杂矢量路径编辑
- 首版不做全量节点逐帧命中检测

### 11.3 建议指标

- 中型画布缩放和平移 55-60 FPS
- 重负载短时不低于 30 FPS
- 首次打开中型画布主视区 1-2 秒内可交互
- 视区资源升级在停止交互后 150-400 ms 内启动

## 12. 开发阶段建议

### Phase 0: 技术预研

目标：

- 跑通 PixiJS 基础画布
- 验证 zoom / pan / selection
- 验证 preview / original 资源切换
- 验证基础 effect 节点

交付：

- 单页 POC
- 基础性能数据
- 纹理预算实验结论

### Phase 1: 编辑器骨架

目标：

- 文档模型
- camera
- 选中、多选、框选
- 图片节点增删改
- 本地保存和恢复

交付：

- 可编辑画布 MVP

### Phase 2: 大图与性能

目标：

- 资源分级
- AssetManager
- viewport culling
- LRU
- 性能面板

交付：

- 中型画布性能达标

### Phase 3: 设计稿与 effect

目标：

- designDraft 快照节点
- effect runtime
- effect 降级策略

交付：

- 设计稿和 effect 混排画布

### Phase 4: 稳定性与打磨

目标：

- context lost 恢复
- 导出
- 错误日志
- 性能回归基线

## 13. 任务拆分建议

建议按 6 个工作流拆任务：

1. editor core
2. pixi renderer
3. asset pipeline
4. interaction system
5. effect runtime
6. persistence and recovery

每个工作流都需要：

- 明确 owner
- 明确接口
- 明确验收指标

## 14. 验收标准

满足以下条件可认为 PixiJS 方案进入可开发状态：

- 文档已明确 editor runtime 与 renderer runtime 分层
- 已定义至少 image / designDraft / effect 三类节点模型
- 已定义资源等级与预算策略
- 已明确交互态降级与静止态回补
- 已定义分层场景结构和 renderer 注册机制
- 已给出分阶段实现路径与验证口径

## 15. 后续建议

建议下一步继续补以下两份文档：

- `docs/canvas-data-schema.md`：字段级数据结构
- `docs/pixijs-poc-plan.md`：性能验证和实验方案
