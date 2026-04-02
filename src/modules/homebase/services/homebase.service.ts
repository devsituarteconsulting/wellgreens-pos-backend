import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { StoreConfigService } from './store-config.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HomebaseService {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly stores: StoreConfigService,
    cfg: ConfigService,
  ) {
    this.baseUrl = cfg.get<string>('HOMEBASE_BASE_URL')!;
  }

  async getForResolved<T>(
    store_id: string | undefined,
    path: string,
    params?: Record<string, any>,
  ): Promise<T> {
    const s = this.stores.resolve(store_id);

    if (!s.homebase_api_key) {
      throw new HttpException(
        {
          message: 'Missing homebase_api_key for store',
          path,
          store: { id: s.id },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const bearer = s.homebase_api_key.startsWith('Bearer ')
      ? s.homebase_api_key
      : `Bearer ${s.homebase_api_key}`;

    const headers: Record<string, string> = {
      Authorization: bearer,
    };

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

      const payload =
        err.response?.data || {
          message: err.message,
          path,
          store: { id: s.id },
        };

      throw new HttpException(payload, status);
    }
  }
}
