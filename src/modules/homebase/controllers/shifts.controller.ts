import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HomebaseService } from '../services/homebase.service';
import { TimecardsQueryDto } from '../dtos/timecards.dto';
import { StoreConfigService } from '../services/store-config.service';

@ApiTags('homebase') // <- mismo tag
@Controller('shifts')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class HomebaseShiftsController {
  constructor(private readonly homebase: HomebaseService, private readonly stores: StoreConfigService,) { }

  @Get('all')
  @ApiOperation({ summary: 'Shifts' })
  @ApiOkResponse({ description: 'Retrieve shifts for a given location' })
  inventory(@Query() q: TimecardsQueryDto) {
    const s = this.stores.resolve(q.store_id);
    return this.homebase.getForResolved(q.store_id, `/locations/${s.home_base_location_uuid}/shifts?page=1&per_page=1000&open=false&with_note=false&date_filter=start_at`, q);
  }

}
