# 刷题助手项目说明

## 项目概述

这是部署在 GitHub Pages 的纯前端刷题应用。项目不使用框架、构建工具或后端，浏览器可直接加载静态文件。

## 目录结构

| 路径 | 说明 |
|---|---|
| `index.html` | 页面结构与导航 |
| `styles.css` | 全局样式与响应式布局 |
| `app.js` | 数据迁移、导入、答题和页面逻辑 |
| `data/default-questions.js` | 机械设计与机械原理两套内置默认题库（共 860 道） |
| `sw.js` | GitHub Pages 子路径兼容的离线缓存 |
| `docs/` | 需求、技术和 UI 说明 |
| `templates/题库模板.xlsx` | Excel 导入模板 |

## 技术约束

- 纯静态前端，无 npm 依赖、无编译步骤。
- Excel 解析固定使用 SheetJS 0.20.1 CDN。
- 持久化使用 localForage（IndexedDB），仅保留旧 localStorage 数据迁移逻辑。
- 题型统一为 `single`、`multi`、`fill`。
- 题图既可来自 Excel 的图片字段，也可按“题目 ID = 图片文件名”批量关联。
- 修改后至少执行 `node --check app.js`、`node --check sw.js`，并在本地 HTTP 服务中验证。

## 数据安全

- 增量导入按题目 ID 优先更新，否则按“章节 + 题干”匹配。
- 清空题库时保留内置默认题库；导出完整备份包含题库、错题、收藏、设置和本地题图。
- `outputs/` 是本地题库工作区，不提交 Git。
