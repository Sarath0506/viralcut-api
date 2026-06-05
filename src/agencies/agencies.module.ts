import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AgenciesController } from "./agencies.controller";
import { AgenciesService } from "./agencies.service";

@Module({
  imports: [AuthModule],
  controllers: [AgenciesController],
  providers: [AgenciesService],
})
export class AgenciesModule {}
