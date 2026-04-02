import { BadRequestException, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response as ExpressResponse } from 'express';                   // 👈 type-only import (evita error TS1272)
import { ApiBearerAuth, ApiFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../../auth/guards/supabase.guard';
import { QboService } from '../services/qbo.service';

@ApiTags('qbo')
@Controller('integrations/qbo')
export class QboController {
  constructor(private readonly qbo: QboService) { }

  @ApiBearerAuth('bearer')
  @UseGuards(SupabaseAuthGuard)
  @ApiFoundResponse({ description: 'Redirección a Intuit OAuth2 (302)' })
  @Get('connect')
  connect() {
    const url = this.qbo.buildAuthUrl();
    return { url };
  }

  @ApiOkResponse({ description: 'Estado de conexión a QBO' })
  @Get('status')
  status() {
    return this.qbo.status();
  }

  @ApiBearerAuth('bearer')
  @UseGuards(SupabaseAuthGuard)
  @ApiOkResponse({ description: 'Lista de cuentas (Chart of Accounts)' })
  @Get('accounts')
  async accounts() {
    return this.qbo.listAccounts();
  }

  @ApiBearerAuth('bearer')
  @UseGuards(SupabaseAuthGuard)
  @ApiOkResponse({ description: 'Información de la compañía (CompanyInfo)' })
  @Get('company-info')
  async companyInfo() {
    return this.qbo.getCompanyInfo();
  }

  @ApiBearerAuth('bearer')
  @UseGuards(SupabaseAuthGuard)
  @ApiOkResponse({ description: 'Refresca el access token si expira' })
  @Post('refresh')
  async refresh() {
    return this.qbo.manualRefresh();
  }

  @ApiBearerAuth('bearer')
  @UseGuards(SupabaseAuthGuard)
  @ApiOkResponse({ description: 'Revoca el refresh token y desconecta' })
  @Post('disconnect')
  async disconnect() {
    return this.qbo.revoke();
  }
}

// callback en la raíz para /callback
import { Controller as RootController, Query } from '@nestjs/common';

@ApiTags('qbo')
@RootController()
export class QboCallbackController {
  constructor(private readonly qbo: QboService) { }

  @ApiOkResponse({ description: 'Callback de Intuit con code/realmId' })

  @Get('callback')
  async callback(@Req() req: Request, @Res() res: ExpressResponse) {
    const front = process.env.FRONT_ORIGIN || 'http://localhost:5173';
    const u = new URL('/', front); // 👈 Dashboard

    const cbUrl = req.originalUrl || req.url; // ← incluye ?code=&state=&realmId=
    if (!cbUrl.includes('code=')) throw new BadRequestException('Missing code');

    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const realmId = req.query.realmId as string | undefined;

    if (!code) {
      u.searchParams.set('qbo_bridge', '1');
      u.searchParams.set('connected', 'false');
      if (state) u.searchParams.set('state', state);
      return res.redirect(302, u.toString());
    }

    try {
      const tokens = await this.qbo.exchangeFromCallbackUrl(cbUrl);
      // guarda tokens asociados a tu userId + realmId...
      u.searchParams.set('qbo_bridge', '1');
      u.searchParams.set('connected', 'true');
      if (realmId) u.searchParams.set('realmId', realmId);
      u.searchParams.set('token_type', tokens.token_type || 'bearer');
      if (state) {
        u.searchParams.set('state', state);
        this.qbo.setRealmId(realmId);
      }
      return res.redirect(302, u.toString());
    } catch {
      u.searchParams.set('qbo_bridge', '1');
      u.searchParams.set('connected', 'false');
      u.searchParams.set('error', 'token_exchange_failed');
      if (state) u.searchParams.set('state', state);
      return res.redirect(302, u.toString());
    }
  }
}


  // @Get('callback')
  // async callback(@Req() req: Request, @Query('realmId') realmId?: string, @Query('state') state?: string) {
  //   // (Opcional en prod) valida state: 
  //   // if (!this.qbo.validateState(state)) throw new BadRequestException('Invalid state');

  //   // Verifica que sí venga ?code=
  //   const cbUrl = req.originalUrl || req.url; // ← incluye ?code=&state=&realmId=
  //   if (!cbUrl.includes('code=')) throw new BadRequestException('Missing code');

  //   // Guarda realmId (demo: memoria)
  //   this.qbo.setRealmId(realmId);

  //   // 🔑 Pasa la URL COMPLETA al SDK (requerido por intuit-oauth)
  // const tokens = await this.qbo.exchangeFromCallbackUrl(cbUrl);

  //   return { received: true, connected: true, realmId: realmId ?? null, token_type: tokens.token_type };
  // }