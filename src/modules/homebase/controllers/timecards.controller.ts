import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HomebaseService } from '../services/homebase.service';
import { TimecardsQueryDto } from '../dtos/timecards.dto';
import { StoreConfigService } from '../services/store-config.service';

@ApiTags('homebase') // <- mismo tag
@Controller('timecards')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class HomebaseTimecardsController {
  constructor(private readonly homebase: HomebaseService, private readonly stores: StoreConfigService,) { }

  @Get('all')
  @ApiOperation({ summary: 'Timecards' })
  @ApiOkResponse({ description: 'Returns a list of timecards for the specified location.' })
  inventory(@Query() q: TimecardsQueryDto) {
    const s = this.stores.resolve(q.store_id);
    return this.homebase.getForResolved(q.store_id, `/locations/${s.home_base_location_uuid}/timecards?page=1&per_page=1000&date_filter=clock_in`, q);
  }

}
