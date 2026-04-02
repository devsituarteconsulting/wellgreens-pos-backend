import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtVerify, decodeProtectedHeader } from 'jose';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    // 👇 deja pasar preflight (y HEAD si quieres)
    if (req.method === 'OPTIONS' || req.method === 'HEAD') return true;

    const auth = req.headers['authorization'] as string | undefined;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const { alg } = decodeProtectedHeader(token);
    const ISSUER = process.env.SUPABASE_ISSUER!;
    const AUD = process.env.SUPABASE_AUDIENCE || 'authenticated';

    try {
      if (alg === 'HS256') {
        const secret = process.env.SUPABASE_JWT_SECRET;
        if (!secret) throw new UnauthorizedException('Missing SUPABASE_JWT_SECRET');
        const key = new TextEncoder().encode(secret);
        const { payload } = await jwtVerify(token, key, {
          issuer: ISSUER,
          audience: AUD,
          clockTolerance: 60,
        });
        (req as any).user = payload;
        return true;
      }
      throw new UnauthorizedException(`Unsupported alg: ${alg}`);
    } catch (e: any) {
      if (e?.code === 'ERR_JWT_EXPIRED') throw new UnauthorizedException('Token expired');
      if (e?.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED')
        throw new UnauthorizedException(`Invalid claim: ${e.claim}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
