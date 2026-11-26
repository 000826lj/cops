import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './db.js';
import { HttpError } from './errors.js';
import type { AssetRow } from './types.js';

const COOKIE = 'pb_gallery_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 天，秒

function galleryToken(config: AppConfig): string {
  return jwt.sign({ scope: 'gallery' }, config.jwtSecret, { subject: 'gallery', expiresIn: `${SESSION_MAX_AGE}s` });
}

function verifyGalleryToken(token: string | undefined, config: AppConfig): boolean {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    return payload.scope === 'gallery';
  } catch {
    return false;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function galleryAuth(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = parseCookies(req.header('cookie'))[COOKIE];
    if (!verifyGalleryToken(token, config)) {
      next(new HttpError(401, '相册访问密码未验证', 'GALLERY_UNAUTHORIZED'));
      return;
    }
    next();
  };
}

function resolveAssetFile(config: AppConfig, asset: AssetRow): string {
  const storageRoot = fs.realpathSync(config.storagePath);
  const target = path.resolve(config.storagePath, asset.relative_path);
  const realTarget = fs.existsSync(target) ? fs.realpathSync(target) : target;
  if (realTarget !== storageRoot && !realTarget.startsWith(storageRoot + path.sep)) {
    throw new HttpError(400, '媒体路径无效', 'INVALID_PATH');
  }
  return realTarget;
}

function assetListItem(asset: AssetRow) {
  return {
    id: asset.id,
    fileName: asset.original_filename,
    capturedAt: asset.captured_at,
    mediaType: asset.media_type,
    mimeType: asset.mime_type,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    duration: asset.duration
  };
}

export function mountGallery(router: Router, config: AppConfig, db: AppDatabase): void {
  const requireGallery = galleryAuth(config);

  router.get('/login', (req, res) => {
    if (verifyGalleryToken(parseCookies(req.header('cookie'))[COOKIE], config)) {
      res.redirect('/gallery/');
      return;
    }
    res.type('html').send(loginPage());
  });

  router.post('/login', express.json({ limit: '8kb' }), (req: Request, res: Response) => {
    if (!config.galleryPassword) {
      throw new HttpError(503, '服务端尚未设置相册访问密码', 'GALLERY_PASSWORD_NOT_SET');
    }
    const supplied = typeof req.body?.password === 'string' ? req.body.password : '';
    const a = crypto.createHash('sha256').update(supplied).digest();
    const b = crypto.createHash('sha256').update(config.galleryPassword).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      throw new HttpError(401, '相册访问密码错误', 'INVALID_GALLERY_PASSWORD');
    }
    res.cookie(COOKIE, galleryToken(config), {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: SESSION_MAX_AGE * 1000,
      path: '/gallery'
    });
    res.json({ ok: true });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/gallery' });
    res.json({ ok: true });
  });

  router.get('/api/session', requireGallery, (_req, res) => res.json({ authenticated: true }));

  router.get('/api/assets', requireGallery, (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const assets = db.prepare('SELECT * FROM assets ORDER BY captured_at DESC, created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as AssetRow[];
    const total = (db.prepare('SELECT COUNT(*) AS count FROM assets').get() as { count: number }).count;
    res.json({ total, items: assets.map(assetListItem) });
  });

  router.get('/api/media/:id', requireGallery, (req, res) => {
    const asset = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id) as AssetRow | undefined;
    if (!asset) throw new HttpError(404, '照片不存在', 'NOT_FOUND');
    const file = resolveAssetFile(config, asset);
    if (!fs.existsSync(file)) throw new HttpError(404, '媒体文件已丢失', 'FILE_MISSING');
    const stat = fs.statSync(file);
    const contentType = asset.mime_type;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(asset.original_filename)}`);

    const range = req.header('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        return;
      }
      let start: number;
      let end: number;
      if (match[1] === '' && match[2] !== '') {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) {
          res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
          return;
        }
        start = Math.max(0, stat.size - suffix);
        end = stat.size - 1;
      } else {
        start = match[1] === '' ? 0 : Number(match[1]);
        end = match[2] === '' ? stat.size - 1 : Number(match[2]);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        return;
      }
      end = Math.min(end, stat.size - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.setHeader('Content-Length', String(stat.size));
    fs.createReadStream(file).pipe(res);
  });

  router.get('/api/download/:id', requireGallery, (req, res) => {
    const asset = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id) as AssetRow | undefined;
    if (!asset) throw new HttpError(404, '照片不存在', 'NOT_FOUND');
    const file = resolveAssetFile(config, asset);
    if (!fs.existsSync(file)) throw new HttpError(404, '媒体文件已丢失', 'FILE_MISSING');
    res.setHeader('Content-Type', asset.mime_type);
    res.setHeader('Content-Length', String(fs.statSync(file).size));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(asset.original_filename)}`);
    fs.createReadStream(file).pipe(res);
  });

  router.get('/', (req, res) => {
    const authed = verifyGalleryToken(parseCookies(req.header('cookie'))[COOKIE], config);
    res.type('html').send(galleryPage(authed));
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
}

function loginPage(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>家庭相册 · 登录</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f7;color:#1c1c1e;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.box{width:100%;max-width:360px;background:#fff;border-radius:20px;padding:32px 24px;box-shadow:0 8px 30px rgba(0,0,0,.06)}
h1{font-size:24px;margin:0 0 8px}p{color:#8e8e93;font-size:14px;margin:0 0 24px}
input{width:100%;padding:14px 16px;font-size:16px;border:1px solid #d1d1d6;border-radius:12px;outline:none}
input:focus{border-color:#007aff}button{width:100%;margin-top:16px;padding:14px;font-size:16px;font-weight:600;color:#fff;background:#007aff;border:0;border-radius:12px;cursor:pointer}
button:disabled{opacity:.5}.msg{color:#ff3b30;font-size:14px;margin-top:12px;min-height:20px}
</style></head><body>
<div class="box"><h1>家庭相册</h1><p>输入访问密码查看备份的照片和视频</p>
<input id="pw" type="password" placeholder="访问密码" autocomplete="current-password" enterkeyhint="done">
<button id="btn" onclick="login()">进入相册</button><div class="msg" id="msg"></div></div>
<script>
async function login(){const btn=document.getElementById('btn'),msg=document.getElementById('msg'),pw=document.getElementById('pw').value;
btn.disabled=true;msg.textContent='';
try{const r=await fetch('/gallery/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
if(r.ok){location.href='/gallery/';return}let d={};try{d=await r.json()}catch(e){}msg.textContent=(d.error&&d.error.message)||'登录失败'}catch(e){msg.textContent='网络错误：'+e.message}
btn.disabled=false}
document.getElementById('pw').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
</script></body></html>`;
}

function galleryPage(authed: boolean): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>家庭相册</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f7;color:#1c1c1e;padding-bottom:40px}
header{position:sticky;top:0;z-index:10;background:rgba(245,245,247,.9);backdrop-filter:blur(12px);padding:16px 20px;border-bottom:1px solid #e5e5ea;display:flex;align-items:center;justify-content:space-between}
h1{font-size:20px;margin:0}.sub{font-size:13px;color:#8e8e93;margin-top:2px}
button{font:inherit;cursor:pointer}.logout{border:0;background:transparent;color:#007aff;font-size:14px}
#main{max-width:1100px;margin:0 auto;padding:20px}.month{margin:24px 0 8px;font-size:17px;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px}
.cell{position:relative;aspect-ratio:1;overflow:hidden;border-radius:8px;background:#e5e5ea;cursor:pointer}
.cell img,.cell video{width:100%;height:100%;object-fit:cover;display:block}
.badge{position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;padding:2px 6px;border-radius:6px}
.name{position:absolute;right:6px;top:6px;left:6px;color:#fff;font-size:10px;text-shadow:0 1px 3px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .15s}
.cell:hover .name{opacity:1}
.empty{text-align:center;color:#8e8e93;padding:80px 20px;line-height:1.8}
#more{display:block;margin:24px auto;padding:12px 24px;border:0;border-radius:10px;background:#007aff;color:#fff;font-weight:600}
#lightbox{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.92);display:none;flex-direction:column;align-items:center;justify-content:center;padding:20px}
#lightbox.show{display:flex}.lb-media{max-width:100%;max-height:78vh;object-fit:contain}
.lb-bar{color:#fff;display:flex;gap:16px;align-items:center;margin-top:16px;font-size:14px}
.lb-bar a,.lb-bar button{color:#fff;background:transparent;border:1px solid rgba(255,255,255,.4);border-radius:8px;padding:8px 14px;text-decoration:none;font-size:14px;cursor:pointer}
.lb-close{position:absolute;top:16px;right:20px;font-size:28px;color:#fff;background:none;border:0;cursor:pointer}
.loading{text-align:center;color:#8e8e93;padding:40px}
</style></head><body>
<header><div><h1>家庭相册</h1><div class="sub" id="sub">正在加载…</div></div><button class="logout" onclick="logout()">退出</button></header>
<div id="main">${authed ? '<div class="loading" id="loading">正在加载照片…</div>' : '<div class="empty">登录状态已失效，请刷新页面重新登录。</div>'}</div>
<div id="lightbox" onclick="if(event.target===this)closeBox()">
<button class="lb-close" onclick="closeBox()">×</button>
<div id="lbContent"></div>
<div class="lb-bar"><span id="lbName"></span><a id="lbDownload" download>下载原图</a><button onclick="closeBox()">关闭</button></div>
</div>
<script>
const authed=${authed ? 'true' : 'false'};
let offset=0,total=0,loading=false;
const main=document.getElementById('main');
function fmtDate(s){const d=new Date(s);return isNaN(d)?'':(d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日 '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'))}
function monthKey(s){const d=new Date(s);return isNaN(d)?'未知':(d.getFullYear()+'年'+(d.getMonth()+1)+'月')}
function esc(s){const div=document.createElement('div');div.textContent=s||'';return div.innerHTML}
async function api(path){const r=await fetch(path);if(r.status===401){main.innerHTML='<div class="empty">登录已过期，请刷新页面重新登录。</div>';throw new Error('unauthorized')}if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
async function load(){
if(loading)return;loading=true;
try{const d=await api('/gallery/api/assets?limit=60&offset='+offset);total=d.total;
document.getElementById('sub').textContent='共 '+total+' 项 · 已显示 '+Math.min(offset+d.items.length,total);
if(offset===0)main.innerHTML='';
const loadingEl=document.getElementById('loading');if(loadingEl)loadingEl.remove();
if(d.items.length===0&&offset===0){main.innerHTML='<div class="empty">还没有照片备份上来。<br>在 iPhone 上打开 App 并允许访问所有照片后，照片会出现在这里。</div>'}
let lastMonth=null,grid=null;
for(const it of d.items){const mk=monthKey(it.capturedAt);
if(mk!==lastMonth){const h=document.createElement('div');h.className='month';h.textContent=mk;main.appendChild(h);grid=document.createElement('div');grid.className='grid';main.appendChild(grid);lastMonth=mk}
const cell=document.createElement('div');cell.className='cell';
if(it.mediaType==='video'){const v=document.createElement('video');v.src='/gallery/api/media/'+it.id;v.preload='metadata';v.muted=true;v.playsInline=true;cell.appendChild(v);const b=document.createElement('span');b.className='badge';b.textContent='▶ 视频';cell.appendChild(b);cell.onclick=()=>openBox(it)}
else{const img=document.createElement('img');img.src='/gallery/api/media/'+it.id;img.loading='lazy';cell.appendChild(img);cell.onclick=()=>openBox(it)}
const n=document.createElement('div');n.className='name';n.textContent=it.fileName;cell.appendChild(n);
grid.appendChild(cell)}
offset+=d.items.length;
const old=document.getElementById('more');if(old)old.remove();
if(offset<total){const btn=document.createElement('button');btn.id='more';btn.textContent='加载更多（'+offset+' / '+total+'）';btn.onclick=load;main.appendChild(btn)}
}catch(e){if(e.message!=='unauthorized'){main.innerHTML='<div class="empty">加载失败：'+esc(e.message)+'</div>'}}
loading=false}
function openBox(it){const box=document.getElementById('lightbox'),c=document.getElementById('lbContent');
c.innerHTML='';const src='/gallery/api/media/'+it.id;
if(it.mediaType==='video'){const v=document.createElement('video');v.src=src;v.controls=true;v.autoplay=true;v.playsInline=true;v.className='lb-media';c.appendChild(v)}
else{const img=document.createElement('img');img.src=src;img.className='lb-media';c.appendChild(img)}
document.getElementById('lbName').textContent=it.fileName+' · '+fmtDate(it.capturedAt);
const a=document.getElementById('lbDownload');a.href='/gallery/api/download/'+it.id;a.setAttribute('download',it.fileName);
box.classList.add('show')}
function closeBox(){const box=document.getElementById('lightbox');box.classList.remove('show');document.getElementById('lbContent').innerHTML=''}
async function logout(){await fetch('/gallery/logout',{method:'POST'});location.href='/gallery/login'}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeBox()});
if(authed)load();
</script></body></html>`;
}
