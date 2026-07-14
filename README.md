# OptiDomain

一个无依赖的静态 Cloudflare 优选 IP 展示页。页面只展示 `:443` 节点，并提供主域名、随机泛域名、TCP Test、节点表格与由实时数据计算的网络概览。

## 功能

- 显示主机 `cdn.fiatnorm.us.kg:443`，并可一键复制或进行 TCP Test。
- 泛域名按钮每次生成 4–6 位小写字母/数字前缀；完整域名仅短暂显示，随后恢复 `*.cdn.fiatnorm.us.kg:443`。
- 从 `optimized_cf_ips.txt` 读取 IP、国家、COLO、延迟、丢包、下载和评分。
- 由节点数据计算最低延迟、最高下载、边缘位置覆盖和源数据时间。
- 提供三步连接说明：选择节点、设置 Host/SNI、确认 443 连通性。
- 宽屏布局锁定在单页内；移动端改为可读的纵向布局。
- PWA Service Worker 缓存静态资产，并对节点数据使用网络优先策略。

## 本地预览

在项目根目录运行：

```powershell
python -m http.server 8050 --bind 127.0.0.1
```

打开 [http://127.0.0.1:8050/](http://127.0.0.1:8050/)。

## 数据格式

`optimized_cf_ips.txt` 的每条节点记录格式为：

```text
IP:PORT#COUNTRY COLO LATENCY LOSS DOWNLOAD SCORE
```

`DOWNLOAD` 或 `SCORE` 可以缺失；推荐以 `-` 占位，页面会保留该节点并将缺失值显示为 `—`。网络概览只使用实际存在的数值，不会将缺失字段当作零值。

首行可选时间戳使用单个 `#`，并在存在时显示：

```text
#ExecutionTime: YYYY-MM-DD HH:MM:SS
```

## 验证

```powershell
node --check script.js
git diff --check
```

修改视觉布局后，请在至少一个宽屏视口和一个窄屏视口检查：表格、泛域名操作、页脚与 Quick Setup 区域。

## 技术栈

- Vanilla HTML、CSS、ES modules
- Google Fonts（Manrope、DM Mono、Material Symbols）
- Service Worker

## License

[MIT License](https://opensource.org/license/mit)
