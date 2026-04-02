import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { StoreConfigService } from './store-config.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DutchieService {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly stores: StoreConfigService,
    cfg: ConfigService,
  ) {
    this.baseUrl = cfg.get<string>('DUTCHIE_BASE_URL')!;
  }

  async getForResolved<T>(
    store_id: string | undefined,
    path: string,
    params?: Record<string, any>,
  ): Promise<T> {
    const s = this.stores.resolve(store_id);
    const authHeader = s.auth_header.startsWith('Basic ')
      ? s.auth_header
      : `Basic ${s.auth_header}`;

    const headers: Record<string, string> = { Authorization: authHeader };
    if (s.api_key) headers['x-api-key'] = s.api_key;

    try {
      const { data } = await firstValueFrom(
        this.http.get<T>(path, {
          baseURL: this.baseUrl,
          params,
          headers,
        }),
      );
      return data;
    } catch (e) {
      const err = e as AxiosError<any>;
      const status = (err.response?.status as number) || HttpStatus.BAD_GATEWAY;
      const payload = err.response?.data || {
        message: err.message,
        path,
        store: { id: s.id, dutchie_store_id: s.dutchie_store_id },
      };
      throw new HttpException(payload, status);
    }
  }
}
