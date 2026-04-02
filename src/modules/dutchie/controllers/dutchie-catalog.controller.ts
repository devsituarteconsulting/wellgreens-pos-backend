import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DutchieService } from '../services/dutchie.service';
import { PageDto, SearchDto, StoreSelectorDto } from '../dtos/common.dto';

@ApiTags('dutchie') // <- mismo tag
@Controller('dutchie')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DutchieCatalogController {
  constructor(private readonly dutchie: DutchieService) {}

  @Get('purchase-order')
  @ApiOperation({ summary: 'Purchase orders' })
  @ApiOkResponse({ description: 'Dutchie purchase orders' })
  purchaseOrder(@Query() q: StoreSelectorDto & PageDto & { status?: string }) {
    return this.dutchie.getForResolved(q.store_id, '/purchase-order', q);
  }

  @Get('product-category')
  @ApiOperation({ summary: 'Product categories' })
  @ApiOkResponse({ description: 'Dutchie product categories' })
  productCategory(@Query() q: StoreSelectorDto & PageDto & SearchDto) {
    return this.dutchie.getForResolved(q.store_id, '/product-category', q);
  }

  @Get('products')
  @ApiOperation({ summary: 'Products' })
  @ApiOkResponse({ description: 'Dutchie products' })
  products(@Query() q: StoreSelectorDto & PageDto & SearchDto & { category_id?: string }) {
    return this.dutchie.getForResolved(q.store_id, '/products', q);
  }
}
