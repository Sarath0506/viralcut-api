import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";

import type { Env } from "../config/env";
import { NotificationsModule } from "../notifications/notifications.module";
import { BrandInviteService } from "./brand-invite.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { FixedOtpService } from "./fixed-otp.service";
import { JwtStrategy } from "./jwt.strategy";
import { OtpService } from "./otp.service";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get("JWT_SECRET", { infer: true }),
      }),
    }),
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    BrandInviteService,
    OtpService,
    FixedOtpService,
    JwtStrategy,
  ],
  exports: [AuthService, BrandInviteService, JwtModule],
})
export class AuthModule {}
