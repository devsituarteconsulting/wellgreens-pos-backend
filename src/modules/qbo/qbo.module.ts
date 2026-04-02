import { Module } from '@nestjs/common';
import { QboController, QboCallbackController } from './controllers/qbo.controller';
import { QboService } from './services/qbo.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [QboController, QboCallbackController],
  providers: [QboService],
  exports: [QboService],
})
export class QboModule {}
