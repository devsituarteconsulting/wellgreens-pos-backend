import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DutchieService } from '../services/dutchie.service';
import { DateRangeDto, PageDto, SearchDto, StoreSelectorDto } from '../dtos/common.dto';
import { ReceivedInventoryQueryDto } from '../dtos/received-inventory.dto';
import { ReceivedInventoryTransactionQueryDto } from '../dtos/received-inventory-transaction.dto copy';
import { InventorySnapshotQueryDto } from '../dtos/inventory-snapshot.dto';

@ApiTags('dutchie') // <- mismo tag
@Controller('inventory')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DutchieInventoryController {
  constructor(private readonly dutchie: DutchieService) { }

  @Get('snapshot')
  @ApiOperation({ summary: 'Inventory snapshot' })
  @ApiOkResponse({ description: 'Dutchie inventory' })
  inventory(@Query() q: InventorySnapshotQueryDto) {
    return this.dutchie.getForResolved(q.store_id, '/inventory/snapshot', q);
  }

  @Get('receivedinventory')
  @ApiOperation({ summary: 'Received inventory (history)' })
  @ApiOkResponse({ description: 'Dutchie received inventory' })
  receivedInventory(@Query() q: ReceivedInventoryQueryDto) {
    return this.dutchie.getForResolved(q.store_id, '/inventory/receivedinventory', q);
  }

  @Get('inventorytransaction')
  @ApiOperation({ summary: 'Inventory transactions' })
  @ApiOkResponse({ description: 'Dutchie inventory transactions' })
  inventoryTransaction(@Query() q: ReceivedInventoryTransactionQueryDto) {
    return this.dutchie.getForResolved(q.store_id, '/inventory/inventorytransaction', q);
  }
}
