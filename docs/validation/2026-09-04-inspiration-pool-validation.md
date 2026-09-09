# 2026-09-04 workspace 独立灵感池验证

- 状态：独立 workspace 灵感池的存储、记录、检索、添加到画板、出处与备份语义完成；自动化门禁、真实浏览器与打包 smoke 通过。
- 代码基线：`codex/inspiration-pool` 三个提交（`195fc00`、`9fad194`、`ef0073c`），merge `51f276b` 后进入 `main`；本报告写于 `main` HEAD `36a58cd`。
- 环境：macOS arm64；Node.js runtime 与仓库一致；使用独立临时 workspace，不读取或改写仓库 Board/Run/Workflow 数据。

## 1. 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | 通过：90 个测试文件，987 个用例 |
| `pnpm exec tsc --noEmit` | 通过，exit 0 |
| `pnpm build` | 通过，无 500 kB chunk warning |
| `pnpm build:bridge` | 通过，exit 0 |
| `git diff --check` | 通过，exit 0 |
| `pnpm desktop:make:arm64` | 生成 `out/desktop/Mira-darwin-arm64/Mira.app`、DMG 与 ZIP |
| `pnpm desktop:smoke:packed:arm64` | 通过 |

## 2. 真实 UI 证据

验证使用独立临时 workspace `/tmp/mira-ui-insp-pool` 与 `http://127.0.0.1:56302/graphmind/`。

1. `GET /inspiration-pool` 返回空的 `inspiration-pool`；新建 Board `board-d6et1pmtlwivu6`（标题“灵感池验收”）成功。
2. 桌面 UI：点`灵感`后弹窗显示“灵感池 / 工作区灵感 · 0 条”，DOM 中没有来源画板下拉。
3. 点`记录灵感`并提交正文“可运行验证清单：每条检查必须有可观察信号与通过标准。”；界面显示“已记录到灵感池”，计数变为 1 条。
4. `inspiration-pool-v2.json` 写入一条 `InspirationEntry`：`inspiration-qnrjyjmtlwjq4q`，版本 `inspiration-version-azqwvxmtlwjq4q`，无画布坐标。
5. 返回检索、选择该条目并点`添加到当前画板（1）`；弹窗关闭，Board 中出现一张 Card，服务端返回该 Card 的 `inspirationRef` 为 `{ poolId, entryId, versionId }`。
6. Board 中无 Transformation、无 Run；Card 内容与灵感池当前版本一致。
7. 390px 全屏 sheet：弹窗矩形为 390×844，页面无横向溢出，`结果 / 已选`分段入口可见。
8. console 只出现 favicon.ico 404（既有噪音），无应用错误或 warning。

## 3. 四维结论

- 产品命题：workspace 级独立池成立。记录不创建 Board Card、不改变 CanvasHistory；只有显式添加才创建带 pool 出处的普通 Card。
- 交互可发现性：真实浏览器走通“记录 → 返回检索 → 选择 → 添加到画板”；390px sheet 可达。未做无教学外部用户研究。
- 产物质量：灵感正文原样进入 Card 快照；后续池条目删除或修改不会同步到已放入画板的 Card。
- 实现正确性：store 原子写入、HTTP 路由、Store/API/UI、备份/恢复、可移植出处与测试覆盖一致；旧 Board Card 不自动迁入池。

## 4. 已知边界

- 旧 Board 中带 `boardId/cardId` 出处的历史 Card 保留为普通 Card；导入与导出把这类引用按 opaque 处理，不解析为新池条目。
- 完整备份只在写入过池或备份服务创建池文件后携带 `inspirationPool`；旧备份仍可恢复。
- favicon.ico 404 与本次功能无关，属于本地 static root 的既有小噪音。
