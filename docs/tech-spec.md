# 技术设计

## 架构

- 静态文件：`index.html` + `styles.css` + `app.js` + `data/default-questions.js`。
- 第三方脚本：SheetJS 0.20.1、localForage 1.10.0，均通过 CDN 加载。
- 数据存储：localForage/IndexedDB；启动时兼容迁移旧 localStorage。
- 当前数据版本：`v14`。
- 内置默认题库：机械设计 459 道、机械原理 401 道，共 860 道。

## 题目模型

```js
{
  id: 'JX-LG-001',
  source: '机械原理',
  chapter: '机械原理 - 第一章',
  type: 'single', // single | multi | fill
  question: '题干',
  options: ['选项 A', '选项 B'], // 填空题为空数组
  answer: ['A'], // 填空题按空位存文本答案
  explanation: '解析',
  image: '',
  topic: '',
  page: '',
  localNumber: '',
  globalNumber: ''
}
```

## 持久化键

| 键 | 内容 |
|---|---|
| `questionBank` | 标准化题目数组 |
| `errorBook` | `{ questionId, wrongCount, lastWrong }[]` |
| `bookmarks` | 收藏题目 ID 数组 |
| `settings` | 主题与 `dbVersion` |
| `questionImages` | `{ [questionId]: dataUrl }` |

## Excel 解析

1. 以二维数组读取首个工作表。
2. 搜索真实表头行，不假定第一行是表头。
3. 识别必填列和可选元数据列。
4. 选择题将字母答案映射到非空选项；填空题根据题干空位数量拆分答案。
5. 标准化并执行增量更新，最后一次性持久化。

## 部署

- `sw.js` 的作用域使用 `./`，适配 `/my-quiz-app/` 子路径。
- Service Worker 安装时本地核心文件必须成功缓存；CDN 资源失败不阻断安装。
