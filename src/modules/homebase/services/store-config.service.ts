import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export interface HomebaseStore {
  id: string;
  name: string;
  location: string;
  address: string;
  is_active: boolean;
  homebase_api_key?: string;
  home_base_location_uuid: string; // "Basic XXXXX"
}

@Injectable()
export class StoreConfigService {
  private byInternal = new Map<string, HomebaseStore>();

  constructor(private readonly cfg: ConfigService) {
    // 1) Lee y sanea la variable (quita espacios y comillas accidentales)
    const rawPath = this.cfg.get<string>('DUTCHIE_STORES_PATH') ?? 'config/stores.json';
    const p = rawPath.trim().replace(/^['"]|['"]$/g, '');

    // 2) Construye rutas candidatas
    const candidates: string[] = [];
    if (path.isAbsolute(p)) {
      candidates.push(p);
    } else {
      // cwd (Cloud Run usa WORKDIR=/app) → /app/config/stores.json
      candidates.push(path.join(process.cwd(), p));
      // fallback relativo a /dist → /app/dist/../config/stores.json
      candidates.push(path.join(__dirname, '..', '..', p));
      // fallback directo a /app/config/stores.json por si p ya es "config/stores.json"
      candidates.push(path.join('/app', p));
    }

    // 3) Usa la primera que exista
    const absolute = candidates.find(fs.existsSync);
    if (!absolute) {
      // Log útil para depurar
      console.error('[stores] cwd=', process.cwd());
      console.error('[stores] tried=', candidates);
      throw new Error(`stores.json no encontrado (DUTCHIE_STORES_PATH="${rawPath}")`);
    }

    // 4) Carga y construye índices
    const raw = fs.readFileSync(absolute, 'utf8');
    const arr = JSON.parse(raw) as HomebaseStore[];

    for (const s of arr) {
      this.byInternal.set(String(s.id), s);
    }

    // Log leve para confirmar en Cloud Run
    console.log('[stores] loaded from', absolute, 'items=', arr.length);
  }


  resolve(storeId?: string): HomebaseStore {
    const a = storeId ? this.byInternal.get(String(storeId)) : undefined;
    if (!a) {
      throw new NotFoundException(
        `Store not found (store_id=${storeId ?? '-'})`,
      );
    }
    if (!a.is_active) throw new NotFoundException(`Store is not active: ${a.name}`);
    return a;
  }
}
