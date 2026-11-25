import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { AppConfig } from './config.js';
import { HttpError } from './errors.js';

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

export function signToken(user: AuthUser, config: AppConfig): string {
  return jwt.sign(
    { username: user.username, role: user.role },
    config.jwtSecret,
    { subject: String(user.id), expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] }
  );
}

export function authenticate(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authorization = req.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      next(new HttpError(401, '缺少访问令牌', 'UNAUTHORIZED'));
      return;
    }
    try {
      const payload = jwt.verify(authorization.slice(7), config.jwtSecret) as JwtPayload;
      const id = Number(payload.sub);
      if (!Number.isSafeInteger(id) || typeof payload.username !== 'string' || !['admin', 'user'].includes(payload.role)) {
        throw new Error('invalid claims');
      }
      (req as AuthenticatedRequest).user = {
        id,
        username: payload.username,
        role: payload.role as 'admin' | 'user'
      };
      next();
    } catch {
      next(new HttpError(401, '访问令牌无效或已过期', 'UNAUTHORIZED'));
    }
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if ((req as AuthenticatedRequest).user.role !== 'admin') {
    next(new HttpError(403, '需要管理员权限', 'FORBIDDEN'));
    return;
  }
  next();
}
