# English Flow · 词流英语

一个面向日常练习的英语学习网站，包含 NGSL 高频词、3,000 组长短句、核心句型和分级阅读。

## 在线访问

**Render 正式站点：<https://english-flow-mwnn.onrender.com>**

该站点连接 `main` 分支。代码推送到 `main` 后，Render 会依据仓库根目录的 `render.yaml` 自动构建并部署。

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fclosedoor%2Fenglish-flow)

- 单词听读、记忆与难词复习。
- 句子与句型练习、阅读理解和错题回顾。
- 学习进度在当前浏览器保存，支持导出备份和恢复。
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

生产文件位于 `dist/client`。根目录的 `render.yaml` 已配置 Render 静态网站部署、自动更新和缓存响应头。完整步骤见 [DEPLOY-RENDER.md](./DEPLOY-RENDER.md)。

生产构建会根据发布文件生成离线缓存版本。新版完整缓存后，会在旧页面关闭后接管；学习进度仍保留在当前浏览器。构建验证会拦截缓存版本与发布文件不一致的产物。

## 数据与备份

学习进度保存在当前浏览器，不会上传到 GitHub 或服务器。不同域名、设备和浏览器之间需要通过应用内的导出、导入功能迁移。
