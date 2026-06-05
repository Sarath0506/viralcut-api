import { Global, Module } from "@nestjs/common";

import { BrandAccessService } from "./brand-access.service";

@Global()
@Module({
  providers: [BrandAccessService],
  exports: [BrandAccessService],
})
export class AccessModule {}
