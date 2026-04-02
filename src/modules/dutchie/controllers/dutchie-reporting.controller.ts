import { BadRequestException, Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiQuery } from '@nestjs/swagger';
import { DutchieService } from '../services/dutchie.service';
import { DateRangeDto, PageDto, StoreSelectorDto } from '../dtos/common.dto';
import { ReportingTransactionsQueryDto } from '../dtos/reporting-transactions.dto';
import { ReportingProductsQueryDto } from '../dtos/reporting-products.dto';
import { ReportingCustomersQueryDto } from '../dtos/reporting-customers.dto';

@ApiTags('dutchie')
@Controller('reporting')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DutchieReportingController {
    constructor(private readonly dutchie: DutchieService) { }

    // @Get('inventory')
    // @ApiOperation({ summary: 'Reporting: inventory' })
    // @ApiOkResponse({ description: 'Dutchie reporting inventory' })
    // reportingInventory(@Query() q: StoreSelectorDto & DateRangeDto & PageDto) {
    //     return this.dutchie.getForResolved(q.store_id, '/reporting/inventory', q);
    // }

    @Get('transactions')
    @ApiOperation({ summary: 'Reporting: transactions' })
    @ApiOkResponse({ description: 'Dutchie reporting transactions' })
    reportingTransactions(@Query() q: ReportingTransactionsQueryDto) {
        const hasId = q.TransactionId != null;
        const hasLM = !!q.FromLastModifiedDateUTC && !!q.ToLastModifiedDateUTC;
        const hasTD = !!q.FromDateUTC && !!q.ToDateUTC;

        if (!(hasId || hasLM || hasTD)) {
            const now = new Date();
            const from = new Date(now.getTime() - 24 * 60 * 60 * 1000); // últimas 24h
            q.FromDateUTC = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
            q.ToDateUTC = from.toISOString().replace(/\.\d{3}Z$/, 'Z');
            // corrige orden (From <= To)
            const tmp = q.FromDateUTC; q.FromDateUTC = q.ToDateUTC; q.ToDateUTC = tmp;
        }

        return this.dutchie.getForResolved(q.store_id, '/reporting/transactions', q as any);
    }

    @Get('products')
    @ApiOperation({ summary: 'Reporting: products' })
    @ApiOkResponse({ description: 'Dutchie reporting products' })
    reportingProducts(@Query() q: ReportingProductsQueryDto) {
        // si no viene fromLastModifiedDateUTC, por defecto: últimas 24h
        if (!q.fromLastModifiedDateUTC) {
            const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
            q.fromLastModifiedDateUTC = from.toISOString().replace(/\.\d{3}Z$/, 'Z');
        }

        // Dutchie espera PascalCase en el querystring
        const params: Record<string, any> = {
            FromLastModifiedDateUTC: q.fromLastModifiedDateUTC,
        };

        return this.dutchie.getForResolved(
            q.store_id,
            '/reporting/products',
            params,
        );
    }

    @Get('customers')
    @ApiOperation({ summary: 'Reporting: customers' })
    @ApiOkResponse({ description: 'Dutchie reporting customers' })
    reportingCustomers(@Query() q: ReportingCustomersQueryDto) {
        const hasLM = !!q.fromLastModifiedDateUTC && !!q.toLastModifiedDateUTC;
        return this.dutchie.getForResolved("8", '/reporting/customers', q as any);
    }

}
