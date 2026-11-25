# 家庭相册自动备份

本项目包含两部分：

- `ios/`：原生 SwiftUI iPhone App，读取系统相册中的原始照片和视频并增量上传。
- `server/`：Node.js + Express + SQLite 服务端，支持家庭多账号、邀请码、分块续传、SHA-256 去重和用户隔离。

## 1. 部署服务器

服务器要求：Linux、Docker、Docker Compose，以及一个指向服务器的 HTTPS 域名。iOS 正式使用时必须使用 HTTPS。

```bash
cd server
cp .env.example .env
# 编辑 .env，把 JWT_SECRET 改成随机长字符串
# 可用：openssl rand -hex 32
docker compose up -d --build
curl https://你的域名/health
```

建议用 Nginx 或 Caddy 把 HTTPS 域名反向代理到 `127.0.0.1:3000`。照片实际保存在 `server/data/media/user-用户ID/年/月/`，SQLite 位于 `server/data/photos.db`。务必定期备份整个 `server/data/`。

首个注册账号自动成为管理员。管理员登录后可创建家人邀请码：

```bash
curl -X POST https://你的域名/api/invites \
  -H "Authorization: Bearer 登录返回的TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expiresInDays":7}'
```

## 2. 生成和安装 iPhone App

### GitHub 自动生成未签名 IPA

仓库内置 `.github/workflows/build-ipa.yml`。推送到 `main` 或在 GitHub Actions 页面手动运行 `Build unsigned IPA` 后，下载名为 `PhotoBackup-unsigned-ipa` 的构建产物，其中包含：

- `PhotoBackup-unsigned.ipa`：交给你现有的签名工具重签后安装。
- `PhotoBackup-unsigned.ipa.sha256`：用于核对文件完整性。
- `xcodebuild.log`：构建日志。

未签名 IPA 不能直接安装，重签时使用的证书和描述文件必须包含当前设备，并且描述文件的 App ID 要与 `com.selfhosted.PhotoBackup` 匹配；也可以先在 `ios/project.yml` 中修改 `PRODUCT_BUNDLE_IDENTIFIER`，再重新触发构建。

### 在 Mac 本地生成工程

需要一台安装了 Xcode 15+ 的 Mac。Windows 不能直接使用苹果 iOS SDK 编译。

```bash
brew install xcodegen
cd ios
xcodegen generate
open PhotoBackup.xcodeproj
```

在 Xcode 中：

1. 选择 `PhotoBackup` Target → Signing & Capabilities，设置你的 Team 和唯一 Bundle Identifier。
2. 添加 Background Modes，并启用 Background processing（工程配置已声明，签名时仍需核对）。
3. 连接 iPhone，选择真机，Build & Run。
4. App 内填写 HTTPS 服务器地址，注册首个管理员账号。
5. 授权“所有照片”，点击“立即扫描并备份”。

## 自动备份机制

- 首次必须由用户打开 App 并授权所有照片。
- App 启动或回到前台时会扫描相册并补传。
- 系统允许时使用 `BGProcessingTask` 在后台继续。
- 分块上传支持中断后查询缺失分块并续传；服务端按 SHA-256 去重。
- 原始 HEIC/JPG/MOV/MP4 等资源不转码。
- iOS 决定后台执行时机，因此不能保证 App 被强制退出后仍实时上传；重新打开后会自动补齐。

## 本地开发服务端

```bash
cd server
npm install
npm run build
npm test
npm run dev
```

默认服务地址为 `http://localhost:3000`。真机不能使用电脑的 localhost；测试时应使用局域网地址（需临时配置 ATS）或 HTTPS 域名。

## 安全与备份

- 不要把 `.env`、JWT 密钥或数据库提交到 Git。
- 生产环境仅开放 HTTPS，不要直接暴露 3000 端口。
- 每位用户只能查询和完成自己的上传会话与资源。
- 服务端不会删除手机照片，也没有远程删除接口。
- 照片与 SQLite 元数据必须一起备份，推荐每天对 `server/data/` 做快照。
