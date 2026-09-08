import { Module } from "@nestjs/common";

import { CashfreeVerificationService } from "./cashfree-verification.service";

@Module({
  providers: [CashfreeVerificationService],
  exports: [CashfreeVerificationService],
})
export class VerificationModule {}
