import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  ok() {
    return { ok: true, env: process.env.APP_ENV ?? 'dev', time: new Date().toISOString() };
  }
}