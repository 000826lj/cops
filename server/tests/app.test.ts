import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabase, type AppDatabase } from '../src/db.js';
import type { AppConfig } from '../src/config.js';

let root: string;
let db: AppDatabase;
let app: ReturnType<typeof createApp>;
const configFor = (root: string): AppConfig => ({
  port: 0, databasePath: path.join(root, 'db.sqlite'), storagePath: path.join(root, 'media'),
  jwtSecret: 'test-secret-at-least-32-characters-long', jwtExpiresIn: '1h', deviceAccessKey: 'test-device-key-at-least-32-characters',
  galleryPassword: 'gallery-test-password',
  maxFileSize: 1024 * 1024, maxChunkSize: 4, rateLimitWindowMs: 60_000, rateLimitMax: 1000
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-backup-'));
  const config = configFor(root);
  db = createDatabase(config.databasePath);
  app = createApp(config, db);
});
afterEach(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function register(username = 'owner') {
  const response = await request(app).post('/api/auth/register').send({ username, password: 'correct-horse' }).expect(201);
  return response.body.token as string;
}

async function upload(token: string, assetId: string, data: Buffer) {
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const create = await request(app).post('/api/uploads').set('Authorization', `Bearer ${token}`).send({
    assetId, fileName: `${assetId}.jpg`, capturedAt: '2026-11-25T01:02:03Z', mediaType: 'photo',
    mimeType: 'image/jpeg', size: data.length, sha256, width: 10, height: 20, totalChunks: Math.ceil(data.length / 4)
  }).expect(201);
  for (let index = 0; index < Math.ceil(data.length / 4); index++) {
    const chunk = data.subarray(index * 4, Math.min(data.length, (index + 1) * 4));
    await request(app).put(`/api/uploads/${create.body.uploadID}/chunks/${index}`)
      .set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream')
      .set('X-Chunk-Sha256', crypto.createHash('sha256').update(chunk).digest('hex')).send(chunk).expect(200);
  }
  return request(app).post(`/api/uploads/${create.body.uploadID}/complete`).set('Authorization', `Bearer ${token}`).send({}).expect(200);
}

describe('PhotoBackup API', () => {
  it('设备使用预置接入码自动创建账号并保持同一用户', async () => {
    const first = await request(app).post('/api/auth/device').send({
      deviceId: 'iphone-device-0001', deviceName: '测试 iPhone', accessKey: 'test-device-key-at-least-32-characters'
    }).expect(200);
    expect(first.body.token).toBeTypeOf('string');
    expect(first.body.user.role).toBe('admin');
    const second = await request(app).post('/api/auth/device').send({
      deviceId: 'iphone-device-0001', deviceName: '测试 iPhone', accessKey: 'test-device-key-at-least-32-characters'
    }).expect(200);
    expect(second.body.userID).toBe(first.body.userID);
    await request(app).post('/api/auth/device').send({
      deviceId: 'iphone-device-0002', deviceName: '未知设备', accessKey: 'wrong-device-key-000000'
    }).expect(401);
  });

  it('首个用户为管理员，并可登录', async () => {
    const token = await register();
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.user.role).toBe('admin');
    await request(app).post('/api/auth/login').send({ username: 'owner', password: 'wrong-password' }).expect(401);
    await request(app).post('/api/auth/login').send({ username: 'owner', password: 'correct-horse' }).expect(200);
  });

  it('邀请码创建家人账号并隔离资源', async () => {
    const owner = await register();
    const invite = await request(app).post('/api/invites').set('Authorization', `Bearer ${owner}`).send({ expiresInDays: 3 }).expect(201);
    const memberResponse = await request(app).post('/api/auth/register').send({ username: 'member', password: 'another-password', inviteCode: invite.body.code }).expect(201);
    const member = memberResponse.body.token;
    await upload(owner, 'owner-asset', Buffer.from('owner-photo'));
    const ownerAssets = await request(app).get('/api/assets').set('Authorization', `Bearer ${owner}`).expect(200);
    const memberAssets = await request(app).get('/api/assets').set('Authorization', `Bearer ${member}`).expect(200);
    expect(ownerAssets.body.total).toBe(1);
    expect(memberAssets.body.total).toBe(0);
  });

  it('合并分块并对同一用户按哈希去重', async () => {
    const token = await register();
    const data = Buffer.from('abcdefghijk');
    const result = await upload(token, 'asset-one', data);
    expect(result.body.asset.sha256).toBe(crypto.createHash('sha256').update(data).digest('hex'));
    const duplicate = await request(app).post('/api/uploads').set('Authorization', `Bearer ${token}`).send({
      assetId: 'asset-two', fileName: 'copy.jpg', capturedAt: '2026-11-25T01:02:03Z', mediaType: 'photo', mimeType: 'image/jpeg',
      size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), totalChunks: 3
    }).expect(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect((await request(app).get('/api/assets').set('Authorization', `Bearer ${token}`)).body.total).toBe(1);
  });

  it('网页相册需要密码，登录后可读清单和媒体，退出后失效', async () => {
    const token = await register();
    const data = Buffer.from('abcdefghijk');
    const uploaded = await upload(token, 'gallery-asset', data);
    const assetId = uploaded.body.asset.id as string;

    await request(app).get('/gallery/api/assets').expect(401);
    await request(app).post('/gallery/login').send({ password: 'wrong-password' }).expect(401);

    const login = await request(app).post('/gallery/login').send({ password: 'gallery-test-password' }).expect(200);
    const cookie = login.headers['set-cookie'] as unknown as string[];
    expect(cookie.some(c => c.startsWith('pb_gallery_session=') && c.includes('HttpOnly'))).toBe(true);

    const list = await request(app).get('/gallery/api/assets').set('Cookie', cookie).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].fileName).toBe('gallery-asset.jpg');

    const media = await request(app).get(`/gallery/api/media/${assetId}`).set('Cookie', cookie).expect(200);
    expect(Buffer.from(media.body)).toEqual(data);

    const range = await request(app).get(`/gallery/api/media/${assetId}`).set('Cookie', cookie).set('Range', 'bytes=2-5').expect(206);
    expect(Buffer.from(range.body)).toEqual(data.subarray(2, 6));

    const logout = await request(app).post('/gallery/logout').expect(200);
    const cleared = logout.headers['set-cookie'] as unknown as string[];
    const clearedCookie = cleared.map(c => c.split(';')[0]).join('; ');
    await request(app).get('/gallery/api/assets').set('Cookie', clearedCookie).expect(401);
  });

  it('相册页面内置自动刷新与回到前台立即检查', async () => {
    const page = await request(app).get('/gallery/').expect(200);
    expect(page.text).toContain('setInterval');
    expect(page.text).toContain('visibilitychange');
    expect(page.text).toContain('/gallery/api/assets?limit=60&offset=0');
    expect(page.text).toContain('每 3 秒自动刷新');
  });
});
