import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PistilStoresImportService } from '../services/pistil-stores-import.service';

@ApiTags('pistil')
@Controller('pistil')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PistilImportsController {
  constructor(private readonly storesImport: PistilStoresImportService) { }

  @Post('import/stores')
  @ApiOperation({ summary: 'Import pistil stores from CSV' })
  @ApiOkResponse({ description: 'Stores import result' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async importStores(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Missing file');
    return this.storesImport.importCsv(file);
  }
}