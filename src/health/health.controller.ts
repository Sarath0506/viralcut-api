import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiProperty, ApiTags } from "@nestjs/swagger";

import { HealthService } from "./health.service";

class HealthDataDto {
  @ApiProperty({ example: "ok" })
  status!: string;

  @ApiProperty()
  timestamp!: string;

  @ApiProperty({ example: "ok" })
  database!: string;
}

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOkResponse({ type: HealthDataDto, description: "Service health check" })
  getHealth() {
    return this.healthService.check();
  }
}
