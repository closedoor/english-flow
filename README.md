# English Flow · 词流英语

一个面向日常练习的英语学习网站，包含 NGSL 高频词和 3,000 组长短句。首页集中显示本周节奏、单词与句子学习进度、复习和生词本；底部导航为首页、单词、句子。

## 在线访问

**Render 正式站点：<https://english-flow-mwnn.onrender.com>**

该站点连接 `main` 分支。代码推送到 `main` 后，Render 会依据仓库根目录的 `render.yaml` 自动构建并部署；GitHub Actions 会继续等待并核对线上 `build-info.json`，确认正式站点已经切换到本次 commit，同时检查页面标题、浏览器脚本、安装清单、图标和 Service Worker。

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fclosedoor%2Fenglish-flow)

- 单词自由学习：按选定范围连续练习，退出保留位置。
- 英文句卡与看中文说英文。
- 首页的“记录与设置”提供备份、恢复和更新；旧版未完成练习仍可继续。
- 支持离线缓存和添加到主屏幕；语音能力取决于浏览器和设备。

## 本地运行

需要 Node.js 22.13.0 或更新版本。

```bash
npm ci
npm run dev
```

## 构建、验证与部署

```bash
npm run build
npm test
npm run lint
```

生产构建由跨平台 Node.js 脚本执行，不依赖 GNU `timeout`，可在 macOS、Linux 和 Render 上使用。生产文件位于 `dist/client`。根目录的 `render.yaml` 已配置 Render 静态网站部署、自动更新和缓存响应头。完整步骤见 [DEPLOY-RENDER.md](./DEPLOY-RENDER.md)。

生产构建会根据公开学习数据生成内容缓存指纹，并根据全部发布文件生成离线外壳版本。新版完整缓存后，会在旧页面关闭后接管；学习进度仍保留在当前浏览器。构建验证会拦截内容缓存、离线版本、部署身份或发布文件不一致的产物。

## 数据与备份

学习进度保存在当前浏览器，不会上传到 GitHub 或服务器。不同域名、设备和浏览器之间需要通过应用内的导出、导入功能迁移。

阅读模块已从日常界面移除。已有阅读记录仍保留在本机及备份中，旧备份继续兼容。
