import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AccessModule } from "../access/access.module";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeService } from "./realtime.service";

@Module({
  imports: [AccessModule, JwtModule],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeGateway, RealtimeService],
})
export class RealtimeModule {}
