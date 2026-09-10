# Third-party notices

Mira 原创代码、文档及专门制作的演示素材采用根目录 [MIT License](LICENSE)。依赖库继续适用各自许可证；Mira 的 MIT 许可不替代它们的版权、署名或分发条件。

## 运行依赖

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| React / React DOM | 界面运行时 | MIT |
| @xyflow/react | 画布 | MIT |
| Zustand | 浏览器状态 | MIT |
| react-markdown / remark-gfm | Markdown 渲染 | MIT |
| Lucide | 界面图标 | ISC；包内亦保留部分图标的原始 MIT 署名 |

锁文件对应的完整依赖清单、包括传递依赖，见[许可证清单](docs/licenses/dependencies.json)。生产依赖的随包许可证原文见[生产依赖许可证](docs/licenses/production-notices.txt)。这些是当前源码分发的核查记录，不是永久不变的依赖声明；更新依赖后重新生成并检查。

## 开发与桌面工具

Vite、Vitest、esbuild、Electron Forge 等构建工具也各自保留许可证。`color-convert@0.5.3` 的包元数据未声明 license，但随包 `LICENSE` 含 Heather Arthur 的 MIT 授权，清单按该文件补正。`unorm` 提供 MIT/GPL 双许可，本项目选择 MIT。`caniuse-lite`（CC-BY-4.0）与 `spdx-exceptions`（CC-BY-3.0）作为构建工具数据使用，归属和项目地址保留在清单中。

Electron/Chromium 的二进制分发还有运行时自带的第三方许可要求。当前只准备公开源码，未声明桌面二进制可公开发布；将来分发安装包时必须保留 Electron 的 LICENSE、Chromium 第三方许可及应用依赖声明，再完成目标平台验收。

## 素材与参考资料

`docs/assets/` 是本项目界面的截图。案例中的输入材料、模型生成与编辑修订分别标注，不包含虚构为真实的用户访谈。阅读案例引用 Adam Smith（1776）《国富论》的公共领域英文原文，来自 [Project Gutenberg](https://www.gutenberg.org/ebooks/3300)，保留卷、章、篇与原文定位；中文分析由模型生成，不冒充已有中文译本。研究案例只保留公开研究的简短事实摘述与原始链接，原论文和网页的版权仍属于各自权利人，Mira 的 MIT 许可不重新授权这些来源。

`desktop/assets/` 和 `public/favicon.svg` 为项目图形资源。界面字体使用系统字体，不随源码分发商业字体文件。

私有开发中的 `reference/`、`archive/`、原型和日常工作区数据不进入公开源码快照。没有把参考仓库的许可证当作 Mira 的许可证，也没有将其内容重新授权为 MIT。
