# 软件内 GitHub 更新

## 用户操作

在「设置 → 软件更新」选择「检查更新」，发现新版后点击「下载并安装」。旧版入口为「我的工作台 → 软件更新」。先保存正在编辑的内容。

软件从 GitHub Releases 下载，使用内置公钥验证更新包。Windows 安装阶段会关闭应用并运行被动安装器，不需要用户手动寻找或运行下载的安装包。已保存的任务与模型配置保留；不会自动清空工作区。

## 发布约定

- 必须保持 `com.focusai.taskmanager` 和现有更新公钥，确保旧版可更新且数据路径不变。
- 同步递增 Cargo.toml、Cargo.lock 中本应用版本，以及 tauri.conf.json 的版本。
- GitHub Actions 使用仓库已有的 `TAURI_SIGNING_PRIVATE_KEY` 和密码 Secret，私钥不落入源码。
- 工作流通过单元、类型、Rust 测试后生成带 `.sig` 与 `latest.json` 的草稿 Release。
- 验证版本、平台、下载地址、签名及资源完整后才将草稿发布为 Latest；未验证的草稿不会干扰旧更新通道。
- `scripts/publish-reviewed-source.mjs` 默认仅检查白名单文件；`--publish` 使用 GitHub 原子提交且校验远端 HEAD，不修改本机 `.git`。
- 不上传 `.env`、私钥、数据库、用户截图、验收文档中的本机路径或模型/飞书凭据。源码密钥模式扫描不是完整安全审计。

真实模型与飞书接口的调用验收，与更新通道验收分开记录；不得用模拟测试替代真实接口成功结果。
