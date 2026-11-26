# 家庭相册自动备份

本项目包含两部分：

- `ios/`：原生 SwiftUI iPhone App，读取系统相册中的原始照片和视频并增量上传。
- `server/`：Node.js + Express + SQLite 服务端，支持家庭多账号、邀请码、分块续传、SHA-256 去重和用户隔离。

## 1. Windows + FRP 测试

现在先在 Windows 本机运行服务端，FRP 只需把公网端口转发到本机 `3000`：

```text
公网 FRP -> Windows 本机 127.0.0.1:3000
```

1. 进入 `server`，复制 `.env.example` 为 `.env`。
2. 设置 `JWT_SECRET` 和 `DEVICE_ACCESS_KEY`，两者都用随机长字符串。
3. 双击 `start-windows.cmd`，看到 `PhotoBackup server listening on :3000`。
4. 双击 `check-windows.cmd`，确认返回 `{"ok":true}`。
5. 在 GitHub 仓库 Settings -> Secrets and variables -> Actions 中设置：
   - Variables：`PHOTO_BACKUP_SERVER_URL`，例如 `http://你的FRP域名:公网端口`
   - Secrets：`PHOTO_BACKUP_DEVICE_KEY`，值必须与 Windows `.env` 中的 `DEVICE_ACCESS_KEY` 完全一致。
6. 推送或手动运行 Actions，得到新的 IPA。手机安装后不需要输入地址、账号或密码，打开后自动连接并请求相册权限。

测试阶段可使用 HTTP；正式使用建议把 FRP 前面接 HTTPS，再把 `PHOTO_BACKUP_SERVER_URL` 改为 `https://...`。

照片实际保存在 `server/data/media/user-用户ID/年/月/`，SQLite 位于 `server/data/photos.db`。迁移到 Linux 时，把整个 `server/data/` 和 `.env` 一起迁移，并重新构建 IPA 只需替换服务器地址。

## 查看备份的照片（网页相册）

服务内置了一个带密码保护的网页相册，手机和电脑浏览器都能用：

```text
http://47.108.249.177:3000/gallery/
```

1. 打开上面的地址，输入 `.env` 里 `GALLERY_PASSWORD` 的值即可进入。
2. 照片和视频按年月分组显示，点开可看大图或播放视频，也能下载原图。
3. 登录状态保存在浏览器 Cookie 中，30 天内不用重复输入密码，点右上角“退出”可清除。
4. 未登录时无法读取照片清单和媒体文件，接口统一返回 401。

本机地址是 `http://127.0.0.1:3000/gallery/`。如果修改了 `GALLERY_PASSWORD`，需要重启服务生效。

## 2. Linux / Docker 部署

服务器要求：Linux、Docker、Docker Compose。复制 `server/.env.example` 为 `.env`，设置 `JWT_SECRET`、`DEVICE_ACCESS_KEY` 和 `GALLERY_PASSWORD`，然后执行：

```bash
cd server
docker compose up -d --build
curl http://127.0.0.1:3000/health
```

生产环境应在 Nginx 或 Caddy 后使用 HTTPS。

## 3. 生成和安装 iPhone App

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
4. 打开 App，不需要填写任何内容。
5. App 自动连接预置服务器并请求“所有照片”权限；允许后立即开始扫描上传。

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
