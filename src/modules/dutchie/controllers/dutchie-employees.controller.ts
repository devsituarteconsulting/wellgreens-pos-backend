import { BadRequestException, Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiQuery } from '@nestjs/swagger';
import { DutchieService } from '../services/dutchie.service';
import { EmployeesQueryDto } from '../dtos/employees.dto';

@ApiTags('dutchie')
@Controller('employees')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DutchieEmployeesController {
    constructor(private readonly dutchie: DutchieService) { }

    @Get('all')
    @ApiOperation({ summary: 'Employees' })
    @ApiOkResponse({ description: 'Dutchie empoyees' })
    reportingCustomers(@Query() q: EmployeesQueryDto) {
        return this.dutchie.getForResolved("8", '/employees', q as any);
    }

}
