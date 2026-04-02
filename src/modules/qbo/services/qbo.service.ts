// src/modules/qbo/services/qbo.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import OAuthClient = require('intuit-oauth');        // SDK oficial de Intuit
import * as crypto from 'crypto';
import axios from 'axios';

type TokenJson = {
    access_token: string;
    refresh_token: string;
    token_type: 'bearer';
    expires_in: number;
    x_refresh_token_expires_in: number;
    id_token?: string;
};

const memoryStore = {
    realmId: null as string | null,
    tokenJson: null as TokenJson | null,
};

const stateStore = new Map<string, number>(); // state -> timestamp

@Injectable()
export class QboService {
    private oauthClient: OAuthClient;

    // Fijamos explícitamente el redirect en DEV para evitar mismatches
    private readonly fixedRedirect = new URL(
        process.env.QBO_REDIRECT_PATH || '/callback',
        process.env.PUBLIC_BASE_URL || `http://localhost:8080}`
    ).toString();

    constructor() {
        const env = (process.env.QBO_ENV === 'production' ? 'production' : 'sandbox') as
            | 'sandbox'
            | 'production';

        this.oauthClient = new OAuthClient({
            clientId: process.env.QBO_CLIENT_ID!,
            clientSecret: process.env.QBO_CLIENT_SECRET!,
            environment: env,
            redirectUri: this.fixedRedirect,
        });

        // DEBUG de arranque
        // (Puedes comentar esto cuando termines de probar)
        console.log('[QBO] env =', env);
        console.log('[QBO] redirectUri =', this.fixedRedirect);
    }

    /** Genera URL de autorización (usa SDK) con state anti-CSRF */
    buildAuthUrl(): string {
        const state = crypto.randomBytes(16).toString('hex');
        stateStore.set(state, Date.now());

        const scopes = (process.env.QBO_SCOPES || 'com.intuit.quickbooks.accounting')
            .trim()
            .split(/\s+/); // el SDK espera array

        const url = this.oauthClient.authorizeUri({ scope: scopes, state });

        // DEBUG
        console.log('[QBO] authorize URL ->', url);

        return url;
    }

    /** Valida el state (10 minutos de vigencia) */
    validateState(state?: string) {
        if (!state) return false;
        const ts = stateStore.get(state);
        stateStore.delete(state);
        return !!ts && Date.now() - ts < 10 * 60 * 1000;
    }

    /** Guarda realmId (dev: memoria) */
    setRealmId(realmId?: string) {
        memoryStore.realmId = realmId ?? null;
    }

    /** Intercambia code -> tokens via SDK */
    async exchangeFromCallbackUrl(callbackUrl: string) {
        if (!callbackUrl.includes('code=')) throw new InternalServerErrorException({ error: 'invalid_callback' });
        await this.oauthClient.createToken(callbackUrl); // ← el SDK lo requiere así
        const json = this.oauthClient.getToken().getToken();
        memoryStore.tokenJson = json as any;
        return json;
    }

    /** Asegura un access_token válido (refresh si hace falta) */
    async ensureAccessToken(): Promise<string> {
        if (!memoryStore.tokenJson) {
            throw new InternalServerErrorException('No tokens in memory');
        }

        // Si el SDK considera válido el access token actual, úsalo
        if (this.oauthClient.isAccessTokenValid()) {
            return this.oauthClient.getToken().access_token;
        }

        // Si no es válido, refresca con refresh_token
        try {
            await this.oauthClient.refreshUsingToken(memoryStore.tokenJson.refresh_token);
            const json = this.oauthClient.getToken().getToken() as TokenJson;
            memoryStore.tokenJson = json;

            // DEBUG
            console.log('[QBO] refreshed access token. New expires_in (s):', json.expires_in);

            return json.access_token;
        } catch (e: any) {
            const status = e?.response?.status;
            const data = e?.response?.data;
            const msg = e?.message;
            console.error('[QBO] refresh error', { status, data, msg });
            throw new InternalServerErrorException(
                data || { error: 'refresh_failed', message: msg },
            );
        }
    }

    /** Estado de conexión actual */
    status() {
        return {
            connected: !!(memoryStore.realmId && memoryStore.tokenJson?.access_token),
            realmId: memoryStore.realmId,
            hasTokens: !!memoryStore.tokenJson,
            env: process.env.QBO_ENV || 'sandbox',
        };
    }

    /** Ejemplo: listar cuentas (Chart of Accounts) con la Query API */
    async listAccounts() {
        if (!memoryStore.realmId) {
            throw new InternalServerErrorException('Missing realmId');
        }

        const accessToken = await this.ensureAccessToken();
        const base =
            process.env.QBO_API_BASE ||
            'https://sandbox-quickbooks.api.intuit.com/v3/company/';

        const query = 'select * from Account';
        const url = `${base}${memoryStore.realmId}/query?query=${encodeURIComponent(
            query,
        )}&minorversion=65`;

        try {
            const { data } = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/json',
                },
            });
            return data;
        } catch (e: any) {
            const status = e?.response?.status;
            const data = e?.response?.data;
            console.error('[QBO] listAccounts error', { status, data });
            throw new InternalServerErrorException(
                data || { error: 'qbo_accounts_failed' },
            );
        }
    }

    connectedSnapshot() {
        const tok = (memoryStore.tokenJson);
        return {
            connected: !!(memoryStore.realmId && tok?.access_token),
            realmId: memoryStore.realmId,
            env: process.env.QBO_ENV || 'sandbox',
            expires_in: tok?.expires_in ?? null,
            x_refresh_token_expires_in: tok?.x_refresh_token_expires_in ?? null,
            token_type: tok?.token_type ?? null,
        };
    }

    async getCompanyInfo() {
        if (!memoryStore.realmId) throw new InternalServerErrorException('Missing realmId');
        const accessToken = await this.ensureAccessToken();
        const base = process.env.QBO_API_BASE || 'https://sandbox-quickbooks.api.intuit.com/v3/company/';
        const url = `${base}${memoryStore.realmId}/companyinfo/${memoryStore.realmId}?minorversion=65`;
        const { data } = await axios.get(url, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        return data;
    }

    async manualRefresh() {
        // fuerza un refresh y devuelve el snapshot
        await this.ensureAccessToken(); // esto ya refresca si hace falta
        return this.connectedSnapshot();
    }

    async revoke() {
        // Revocar tokens (demo): se recomienda revocar con el refresh_token
        // Doc: POST https://developer.api.intuit.com/v2/oauth2/tokens/revoke
        const clientId = process.env.QBO_CLIENT_ID!;
        const clientSecret = process.env.QBO_CLIENT_SECRET!;
        const refresh = memoryStore.tokenJson?.refresh_token;
        if (!refresh) throw new InternalServerErrorException('No refresh token to revoke');

        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        await axios.post(
            'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
            new URLSearchParams({ token: refresh }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` } }
        );

        // limpia el estado local
        memoryStore.tokenJson = null;
        memoryStore.realmId = null;
        return { revoked: true };
    }
}
