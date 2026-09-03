# Focus AI 个人任务管理器

一个本地优先的 Windows AI 任务与项目管理桌面软件，使用 Nuxt 4、Vue 3、Tauri 2 和 SQLite 构建。

## 主要功能

- Today 工作台、收集箱、项目、里程碑、季度追踪与年终总结
- 任务完整 CRUD、软删除、回收站、提醒和语音录入
- AI 先生成执行计划，用户确认后再写入任务与项目
- MiniMax 与 OpenAI 兼容模型多套配置
- Word、Excel 导入和飞书链接
- 任务附件与图片预览
- GitHub Releases 签名自动更新

## 本地开发

```bash
pnpm install
pnpm dev
```

桌面开发：

```bash
pnpm desktop:dev
```

## 构建 Windows 安装包

```bash
pnpm desktop:build
```

## 数据与密钥安全

- 默认使用本机 SQLite，不要求登录。
- API Key 由 Windows 凭据管理器保存，不写入项目源码或工作区数据。
- `.env`、SQLite 数据库、日志、构建产物和更新签名私钥均被 Git 忽略。
- GitHub Releases 更新包使用独立的 Tauri 更新签名验证。

## 软件更新

桌面端在“我的工作台 → 软件更新”中手动检查更新。公开 Release 由 GitHub Actions 构建并生成 `latest.json`、NSIS 更新包和签名文件。
