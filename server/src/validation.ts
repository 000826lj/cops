import path from 'node:path';
import { HttpError } from './errors.js';

export const mimeExtensions: Record<string, { extension: string; mediaType: 'photo' | 'video' }> = {
  'image/jpeg': { extension: '.jpg', mediaType: 'photo' },
  'image/png': { extension: '.png', mediaType: 'photo' },
  'image/heic': { extension: '.heic', mediaType: 'photo' },
  'image/heif': { extension: '.heif', mediaType: 'photo' },
  'image/webp': { extension: '.webp', mediaType: 'photo' },
  'image/gif': { extension: '.gif', mediaType: 'photo' },
  'video/mp4': { extension: '.mp4', mediaType: 'video' },
  'video/quicktime': { extension: '.mov', mediaType: 'video' },
  'video/x-m4v': { extension: '.m4v', mediaType: 'video' }
};

export function requireString(value: unknown, name: string, min = 1, max = 255): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new HttpError(400, `${name} 长度必须在 ${min}-${max} 之间`, 'VALIDATION_ERROR');
  }
  return value;
}

export function requireInteger(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new HttpError(400, `${name} 必须是 ${min}-${max} 之间的整数`, 'VALIDATION_ERROR');
  }
  return value as number;
}

export function optionalPositiveNumber(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new HttpError(400, `${name} 必须是非负数`, 'VALIDATION_ERROR');
  }
  return value;
}

export function validateFilename(value: unknown): string {
  const filename = requireString(value, 'fileName', 1, 255);
  if (filename.includes('\0') || filename !== path.basename(filename) || filename === '.' || filename === '..' || /[\\/]/.test(filename)) {
    throw new HttpError(400, 'fileName 不能包含路径或空字节', 'VALIDATION_ERROR');
  }
  return filename;
}

export function validateSha256(value: unknown): string {
  const hash = requireString(value, 'sha256', 64, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new HttpError(400, 'sha256 格式无效', 'VALIDATION_ERROR');
  }
  return hash;
}

export function validateCapturedAt(value: unknown): string {
  const capturedAt = requireString(value, 'capturedAt', 1, 64);
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'capturedAt 必须是有效日期', 'VALIDATION_ERROR');
  }
  return date.toISOString();
}
