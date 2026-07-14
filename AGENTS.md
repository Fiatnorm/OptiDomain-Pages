# OptiDomain-Pages

## 项目范围

- 无构建步骤的静态前端：`index.html`、`styles.css`、`script.js`。
- `optimized_cf_ips.txt` 是页面读取的节点数据；前端从 GitHub `main` 的 raw 文件获取它，不要改动其字段格式。
- 节点行允许以 `-` 表示缺失的下载或评分；解析必须保留有效节点，概览仅计算实际数值。首行时间戳格式为 `#ExecutionTime:`。
- `Tcptest.webp` 是连通性快照资源；不要用旧的 `ITDOGTcping.webp` 替换它。
- `sw.js` 管理静态资产和节点数据缓存。修改缓存的静态资源时递增 `CACHE_NAME`，保证预览能拿到最新文件。

## 本地运行与验证

```powershell
python -m http.server 8050 --bind 127.0.0.1
node --check script.js
git diff --check
```

预览地址：`http://127.0.0.1:8050/`。

## 布局约束

- 宽屏（最小高度 750px）必须单页呈现，不产生垂直滚轮。
- 移动端允许纵向滚动，以保证完整内容可访问。
- `Quick Setup` 与上方主模块间距固定为 `14px`；背景、边框和阴影与主模块保持一致。
- 手机端 Hero 的标题区与 `443 ONLY` 锁保持左右分布。
- 表头必须与数据列居中对齐。

## 交互约束

- 泛域名仅在用户点击复制或 TCP Test 时生成，长度为 4–6 位小写字母/数字。
- 完整随机域名约 3.2 秒后必须恢复为默认通配符展示。
- 概览指标必须从当前节点数据计算；不要加入虚构的性能或时间数据。
