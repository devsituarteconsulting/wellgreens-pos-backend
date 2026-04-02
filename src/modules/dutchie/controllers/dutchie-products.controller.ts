import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DutchieService } from '../services/dutchie.service';
import { StoreSelectorDto } from '../dtos/common.dto';

@ApiTags('dutchie')
@Controller('products')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DutchieProductsController {
  constructor(private readonly dutchie: DutchieService) { }

  @Get('categories')
  @ApiOperation({ summary: 'Products' })
  @ApiOkResponse({ description: 'Dutchie products' })
  products(@Query() q: StoreSelectorDto) {
    return this.dutchie.getForResolved(q.store_id, '/product-category', q);
  }
}
