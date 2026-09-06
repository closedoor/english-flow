# 部署 English Flow 到 Render

本应用可以作为静态网站部署，无需数据库、API 密钥或常驻服务器。

## 自动部署

在 Render 新建 Blueprint，选择本 GitHub 仓库，使用根目录的 `render.yaml`。确认它创建的是名为 `english-flow` 的 Static Site 后提交。

也可以手动创建 Static Site：

| 设置 | 值 |
| --- | --- |
| Branch | `main` |
| Build Command | `npm ci && npm run build:render` |
| Publish Directory | `dist/client` |
| Node Version | `22`（至少 22.13.0） |

只发布 `dist/client`，不要发布整个仓库或 `dist/server`。无需 Start Command。按 `render.yaml` 设置缓存头，不要添加 `/* → /index.html` 的重写规则，否则失效的脚本或词库请求可能收到 HTML。

构建会检查词库、生成静态首页，并验证公开资源、页面引用、分享链接、应用图标和安装清单。Render 的 `RENDER_EXTERNAL_URL` 用于生成当前网站的资源地址。每次推送 `main` 后自动重新构建和部署。

## 从原网址迁移进度

浏览器按网址分别保存学习进度。请先在原站的设置中导出进度备份，再在新网站导入，确认恢复成功后再更换桌面图标。新网址需要重新下载离线内容。

## 本地验证

```bash
npm ci
npm test
```

发布前只需要构建时，可运行 `npm run build:render`。不要提交 `.env`、密钥、用户备份、依赖目录或生成产物。
