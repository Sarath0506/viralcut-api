import { Module } from "@nestjs/common";

import { RealtimeModule } from "../realtime/realtime.module";
import { ParticipationService } from "./participation.service";

@Module({
  imports: [RealtimeModule],
  providers: [ParticipationService],
  exports: [ParticipationService],
})
export class ParticipationModule {}
