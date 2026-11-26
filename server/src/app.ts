import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './db.js';
import { authenticate, requireAdmin, signToken, type AuthenticatedRequest } from './auth.js';
import { asyncHandler, errorHandler, HttpError } from './errors.js';
import type { AssetRow, UploadRow, UserRow } from './types.js';
import { mimeExtensions, optionalPositiveNumber, requireInteger, requireString, validateCapturedAt, validateFilename, validateSha256 } from './validation.js';

const json = express.json({ limit: '1mb' });
const id = () => crypto.randomUUID();
const hashText = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const safeUserFolder = (userId: number) => `user-${userId}`;
const chunkFolder = (config: AppConfig, userId: number, uploadId: string) => path.join(config.storagePath, '.chunks', safeUserFolder(userId), uploadId);
const chunkFile = (config: AppConfig, userId: number, uploadId: string, index: number) => path.join(chunkFolder(config, userId, uploadId), `${index}.part`);

function publicUser(user: UserRow) {
  return { id: String(user.id), username: user.username, role: user.role };
}

function assetJson(asset: AssetRow) {
  return {
    id: asset.id, assetId: asset.asset_id, fileName: asset.original_filename,
    capturedAt: asset.captured_at, mediaType: asset.media_type, mimeType: asset.mime_type,
    size: asset.size, sha256: asset.sha256, width: asset.width, height: asset.height,
    duration: asset.duration, createdAt: asset.created_at
  };
}

export function createApp(config: AppConfig, db: AppDatabase) {
  fs.mkdirSync(config.storagePath, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(rateLimit({ windowMs: config.rateLimitWindowMs, limit: config.rateLimitMax, standardHeaders: true, legacyHeaders: false }));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/auth/register', json, asyncHandler(async (req, res) => {
    const username = requireString(req.body?.username, 'username', 3, 64).trim();
    const password = requireString(req.body?.password, 'password', 8, 128);
    const inviteCode = typeof req.body?.inviteCode === 'string' ? req.body.inviteCode : '';
    const userCount = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
    let role: 'admin' | 'user' = 'user';
    let invite: { id: number } | undefined;
    if (userCount === 0) role = 'admin';
    else {
      if (!inviteCode) throw new HttpError(403, '需要有效邀请码', 'INVITE_REQUIRED');
      invite = db.prepare("SELECT id FROM invites WHERE code_hash = ? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)").get(hashText(inviteCode)) as { id: number } | undefined;
      if (!invite) throw new HttpError(403, '邀请码无效或已使用', 'INVALID_INVITE');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const transaction = db.transaction(() => {
        const result = db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run(username, passwordHash, role);
        const userId = Number(result.lastInsertRowid);
        if (invite) db.prepare('UPDATE invites SET used_by=?, used_at=CURRENT_TIMESTAMP WHERE id=?').run(userId, invite.id);
        return userId;
      });
      const userId = transaction();
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as UserRow;
      res.status(201).json({ token: signToken(publicUser(user) as any, config), user: publicUser(user), userID: String(user.id) });
    } catch (error: any) {
      if (String(error?.code).includes('SQLITE_CONSTRAINT')) throw new HttpError(409, '用户名已存在', 'USERNAME_EXISTS');
      throw error;
    }
  }));

  app.post('/api/auth/device', json, asyncHandler(async (req, res) => {
    if (!config.deviceAccessKey) throw new HttpError(503, '服务端尚未配置设备接入码', 'DEVICE_ACCESS_DISABLED');
    const accessKey = requireString(req.body?.accessKey, 'accessKey', 16, 256);
    const suppliedKeyHash = crypto.createHash('sha256').update(accessKey).digest();
    const configuredKeyHash = crypto.createHash('sha256').update(config.deviceAccessKey).digest();
    if (!crypto.timingSafeEqual(suppliedKeyHash, configuredKeyHash)) {
      throw new HttpError(401, '设备接入码无效', 'INVALID_DEVICE_KEY');
    }
    const deviceId = requireString(req.body?.deviceId, 'deviceId', 8, 128);
    const deviceName = requireString(req.body?.deviceName ?? 'iPhone', 'deviceName', 1, 128);
    let device = db.prepare('SELECT * FROM devices WHERE device_id=?').get(deviceId) as { user_id: number } | undefined;
    if (!device) {
      let user = db.prepare("SELECT * FROM users ORDER BY id LIMIT 1").get() as UserRow | undefined;
      if (!user) {
        const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
        const result = db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?, 'admin')").run('device-owner', passwordHash);
        user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(result.lastInsertRowid)) as UserRow;
      }
      db.prepare('INSERT INTO devices(device_id,user_id,device_name) VALUES(?,?,?)').run(deviceId, user.id, deviceName);
      device = { user_id: user.id };
    } else {
      db.prepare('UPDATE devices SET device_name=?,last_seen_at=CURRENT_TIMESTAMP WHERE device_id=?').run(deviceName, deviceId);
    }
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(device.user_id) as UserRow;
    res.json({ token: signToken(publicUser(user) as any, config), user: publicUser(user), userID: String(user.id) });
  }));

  app.post('/api/auth/login', json, asyncHandler(async (req, res) => {
    const username = requireString(req.body?.username, 'username', 1, 64).trim();
    const password = requireString(req.body?.password, 'password', 1, 128);
    const user = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username) as UserRow | undefined;
    if (!user || !(await bcrypt.compare(password, user.password_hash))) throw new HttpError(401, '用户名或密码错误', 'INVALID_CREDENTIALS');
    res.json({ token: signToken(publicUser(user) as any, config), user: publicUser(user), userID: String(user.id) });
  }));

  const auth = authenticate(config);
  app.get('/api/me', auth, (req, res) => res.json({ user: (req as AuthenticatedRequest).user }));
  app.post('/api/invites', auth, requireAdmin, json, (req, res) => {
    const days = req.body?.expiresInDays === undefined ? 7 : requireInteger(req.body.expiresInDays, 'expiresInDays', 1, 365);
    const code = crypto.randomBytes(18).toString('base64url');
    const user = (req as AuthenticatedRequest).user;
    db.prepare("INSERT INTO invites(code_hash,created_by,expires_at) VALUES(?,?,datetime('now',?))").run(hashText(code), user.id, `+${days} days`);
    res.status(201).json({ code, expiresInDays: days });
  });

  app.post('/api/uploads', auth, json, (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const assetId = requireString(req.body?.assetId, 'assetId', 1, 512);
    const fileName = validateFilename(req.body?.fileName);
    const capturedAt = validateCapturedAt(req.body?.capturedAt);
    const mimeType = requireString(req.body?.mimeType, 'mimeType', 3, 128).toLowerCase();
    const info = mimeExtensions[mimeType];
    if (!info) throw new HttpError(415, '不支持此媒体类型', 'UNSUPPORTED_MEDIA');
    const mediaType = req.body?.mediaType;
    if (mediaType !== info.mediaType) throw new HttpError(400, 'mediaType 与 MIME 不匹配', 'VALIDATION_ERROR');
    const size = requireInteger(req.body?.size, 'size', 1, config.maxFileSize);
    const sha256 = validateSha256(req.body?.sha256);
    const totalChunks = requireInteger(req.body?.totalChunks, 'totalChunks', 1, Math.ceil(config.maxFileSize / 1024) + 1);
    const width = optionalPositiveNumber(req.body?.width, 'width');
    const height = optionalPositiveNumber(req.body?.height, 'height');
    const duration = optionalPositiveNumber(req.body?.duration, 'duration');
    const existingAsset = db.prepare('SELECT * FROM assets WHERE user_id=? AND (asset_id=? OR sha256=?)').get(user.id, assetId, sha256) as AssetRow | undefined;
    if (existingAsset) return res.json({ duplicate: true, completed: true, asset: assetJson(existingAsset) });
    let upload = db.prepare("SELECT * FROM uploads WHERE user_id=? AND asset_id=? AND status!='failed' ORDER BY created_at DESC LIMIT 1").get(user.id, assetId) as UploadRow | undefined;
    if (!upload) {
      const uploadId = id();
      db.prepare(`INSERT INTO uploads(id,user_id,asset_id,original_filename,captured_at,media_type,mime_type,expected_size,expected_sha256,width,height,duration,total_chunks,status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`).run(uploadId, user.id, assetId, fileName, capturedAt, mediaType, mimeType, size, sha256, width, height, duration, totalChunks);
      upload = db.prepare('SELECT * FROM uploads WHERE id=?').get(uploadId) as UploadRow;
    }
    const received = new Set((db.prepare('SELECT chunk_index FROM upload_chunks WHERE upload_id=?').all(upload.id) as { chunk_index: number }[]).map(x => x.chunk_index));
    const missingChunks = Array.from({ length: upload.total_chunks }, (_, i) => i).filter(i => !received.has(i));
    res.status(201).json({ uploadID: upload.id, chunkSize: config.maxChunkSize, missingChunks, duplicate: false });
  });

  app.get('/api/uploads/:uploadId', auth, (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const upload = db.prepare('SELECT * FROM uploads WHERE id=? AND user_id=?').get(req.params.uploadId, user.id) as UploadRow | undefined;
    if (!upload) throw new HttpError(404, '上传会话不存在', 'NOT_FOUND');
    const received = new Set((db.prepare('SELECT chunk_index FROM upload_chunks WHERE upload_id=?').all(upload.id) as { chunk_index: number }[]).map(x => x.chunk_index));
    res.json({ uploadID: upload.id, status: upload.status, missingChunks: Array.from({ length: upload.total_chunks }, (_, i) => i).filter(i => !received.has(i)) });
  });

  app.put('/api/uploads/:uploadId/chunks/:index', auth, express.raw({ type: 'application/octet-stream', limit: config.maxChunkSize }), (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    const upload = db.prepare('SELECT * FROM uploads WHERE id=? AND user_id=?').get(req.params.uploadId, user.id) as UploadRow | undefined;
    if (!upload) throw new HttpError(404, '上传会话不存在', 'NOT_FOUND');
    if (upload.status === 'completed') return res.json({ accepted: true, completed: true });
    const index = Number(req.params.index);
    if (!Number.isSafeInteger(index) || index < 0 || index >= upload.total_chunks) throw new HttpError(400, '分块编号无效', 'VALIDATION_ERROR');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0 || req.body.length > config.maxChunkSize) throw new HttpError(400, '分块内容无效', 'VALIDATION_ERROR');
    const suppliedHash = req.header('x-chunk-sha256');
    const actualHash = crypto.createHash('sha256').update(req.body).digest('hex');
    if (suppliedHash && suppliedHash.toLowerCase() !== actualHash) throw new HttpError(422, '分块校验失败', 'HASH_MISMATCH');
    const folder = chunkFolder(config, user.id, upload.id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(chunkFile(config, user.id, upload.id, index), req.body, { flag: 'w' });
    db.prepare(`INSERT INTO upload_chunks(upload_id,chunk_index,size,sha256) VALUES(?,?,?,?)
      ON CONFLICT(upload_id,chunk_index) DO UPDATE SET size=excluded.size,sha256=excluded.sha256,created_at=CURRENT_TIMESTAMP`).run(upload.id, index, req.body.length, actualHash);
    res.json({ accepted: true, index, size: req.body.length, sha256: actualHash });
  });

  app.post('/api/uploads/:uploadId/complete', auth, json, asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const upload = db.prepare('SELECT * FROM uploads WHERE id=? AND user_id=?').get(req.params.uploadId, user.id) as UploadRow | undefined;
    if (!upload) throw new HttpError(404, '上传会话不存在', 'NOT_FOUND');
    if (upload.status === 'completed' && upload.asset_record_id) {
      const asset = db.prepare('SELECT * FROM assets WHERE id=? AND user_id=?').get(upload.asset_record_id, user.id) as AssetRow;
      return res.json({ completed: true, asset: assetJson(asset) });
    }
    const chunks = db.prepare('SELECT chunk_index,size FROM upload_chunks WHERE upload_id=? ORDER BY chunk_index').all(upload.id) as { chunk_index: number; size: number }[];
    if (chunks.length !== upload.total_chunks || chunks.some((c, i) => c.chunk_index !== i)) throw new HttpError(409, '仍有分块未上传', 'CHUNKS_MISSING');
    db.prepare("UPDATE uploads SET status='assembling',updated_at=CURRENT_TIMESTAMP,error=NULL WHERE id=?").run(upload.id);
    const date = new Date(upload.captured_at);
    const relativeDir = path.join(safeUserFolder(user.id), String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0'));
    const mimeInfo = mimeExtensions[upload.mime_type];
    if (!mimeInfo) throw new HttpError(415, '上传会话中的媒体类型不受支持', 'UNSUPPORTED_MEDIA');
    const extension = mimeInfo.extension;
    const relativePath = path.join(relativeDir, `${upload.expected_sha256}${extension}`);
    const target = path.join(config.storagePath, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${upload.id}.tmp`;
    const output = fs.createWriteStream(temp, { flags: 'w' });
    const hash = crypto.createHash('sha256');
    let total = 0;
    for (let i = 0; i < upload.total_chunks; i++) {
      const data = fs.readFileSync(chunkFile(config, user.id, upload.id, i));
      total += data.length; hash.update(data);
      if (!output.write(data)) await new Promise<void>(resolve => output.once('drain', resolve));
    }
    await new Promise<void>((resolve, reject) => { output.end(resolve); output.on('error', reject); });
    const actualHash = hash.digest('hex');
    if (total !== upload.expected_size || actualHash !== upload.expected_sha256) {
      fs.rmSync(temp, { force: true });
      db.prepare("UPDATE uploads SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run('最终文件校验失败', upload.id);
      throw new HttpError(422, '最终文件大小或哈希校验失败', 'HASH_MISMATCH');
    }
    fs.renameSync(temp, target);
    const assetRecordId = id();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO assets(id,user_id,asset_id,original_filename,captured_at,media_type,mime_type,size,sha256,width,height,duration,relative_path)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(assetRecordId, user.id, upload.asset_id, upload.original_filename, upload.captured_at, upload.media_type, upload.mime_type, upload.expected_size, upload.expected_sha256, upload.width, upload.height, upload.duration, relativePath);
      db.prepare("UPDATE uploads SET status='completed',asset_record_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(assetRecordId, upload.id);
    });
    try { tx(); } catch (error: any) {
      const duplicate = db.prepare('SELECT * FROM assets WHERE user_id=? AND (asset_id=? OR sha256=?)').get(user.id, upload.asset_id, upload.expected_sha256) as AssetRow | undefined;
      if (!duplicate) throw error;
      db.prepare("UPDATE uploads SET status='completed',asset_record_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(duplicate.id, upload.id);
    }
    fs.rmSync(chunkFolder(config, user.id, upload.id), { recursive: true, force: true });
    const asset = db.prepare('SELECT * FROM assets WHERE user_id=? AND sha256=?').get(user.id, upload.expected_sha256) as AssetRow;
    res.json({ completed: true, asset: assetJson(asset) });
  }));

  app.get('/api/assets', auth, (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const assets = db.prepare('SELECT * FROM assets WHERE user_id=? ORDER BY captured_at DESC LIMIT ? OFFSET ?').all(user.id, limit, offset) as AssetRow[];
    const total = (db.prepare('SELECT COUNT(*) AS count FROM assets WHERE user_id=?').get(user.id) as { count: number }).count;
    res.json({ total, items: assets.map(assetJson) });
  });

  app.get('/api/stats', auth, (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const row = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM assets WHERE user_id=?').get(user.id) as { count: number; bytes: number };
    res.json({ assets: row.count, bytes: row.bytes });
  });

  app.use((_req, _res, next) => next(new HttpError(404, '接口不存在', 'NOT_FOUND')));
  app.use(errorHandler);
  return app;
}
