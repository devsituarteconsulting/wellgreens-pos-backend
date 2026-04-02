import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';

// === Carga .env local solo si existe (para dev local) ===
(() => {
  const appEnv = process.env.APP_ENV || 'dev';
  const envPath = path.resolve(process.cwd(), 'config', 'env', `${appEnv}.env`);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    // console.log(`[env] loaded ${envPath}`);
  }
})();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Lee orígenes permitidos desde env (separados por coma)
  const allowList = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Regex útil para localhost en cualquier puerto
  const localhostPattern = /^https?:\/\/localhost(:\d+)?$/;

  app.enableCors({
    origin(origin, cb) {
      // Permite llamadas sin Origin (curl/health/SSR)
      if (!origin) return cb(null, true);

      const isAllowed =
        allowList.includes(origin) ||
        localhostPattern.test(origin);

      // Si usas credenciales, Nest reflejará el origin al que digas "true"
      // Si no usas credenciales, igual conviene reflejar el origin válido
      return cb(null, isAllowed ? true : false);
    },
    credentials: true, // pon false si NO usas cookies/sesiones
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept'
    ],
    optionsSuccessStatus: 204,
    maxAge: 86400, // cachea el preflight 24h
  });


  // Swagger solo en dev/qa (o si habilitas explícitamente)
  const env = process.env.APP_ENV || 'dev';
  const enableSwagger = ['dev', 'qa'].includes(env) || process.env.ENABLE_SWAGGER === 'true';
  if (enableSwagger) {
    const cfg = new DocumentBuilder()
      .setTitle('Wellgreens POS Backend')
      .setDescription('APIs de integración (QBO, Dutchie, ETL)')
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      // Evita amarrar a localhost. Usa base relativa:
      .addServer('/') // o .addServer(process.env.PUBLIC_BASE_URL!)
      .build();

    const doc = SwaggerModule.createDocument(app, cfg);
    SwaggerModule.setup('docs', app, doc, { swaggerOptions: { persistAuthorization: true } });
  }

  // Cloud Run inyecta PORT
  const port = 8080;
  app.use(json({ limit: '500mb' }));         // ajusta 10mb/500mb/50mb según necesites
  app.use(urlencoded({ limit: '500mb', extended: true }));
  await app.listen(port, '0.0.0.0'); // ← importante en Cloud Run

  if (enableSwagger) {
    const base = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
    console.log(`Swagger listo en ${base.replace(/\/+$/, '')}/docs`);
  }
}
bootstrap();
