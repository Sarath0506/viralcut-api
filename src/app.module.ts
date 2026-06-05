import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";

import { validateEnv } from "./config/env";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { AccessModule } from "./access/access.module";
import { AgenciesModule } from "./agencies/agencies.module";
import { AuthModule } from "./auth/auth.module";
import { BrandsModule } from "./brands/brands.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { HealthModule } from "./health/health.module";
import { PayoutsModule } from "./payouts/payouts.module";
import { CreatorModule } from "./creator/creator.module";
import { SubmissionsModule } from "./submissions/submissions.module";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";
import { WalletModule } from "./wallet/wallet.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== "production"
            ? { target: "pino-pretty", options: { colorize: true } }
            : undefined,
        redact: [
          "req.headers.authorization",
          "req.body.password",
          "req.body.passwordHash",
        ],
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    PrismaModule,
    AccessModule,
    AuthModule,
    AgenciesModule,
    BrandsModule,
    UsersModule,
    WalletModule,
    PayoutsModule,
    CampaignsModule,
    SubmissionsModule,
    CreatorModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
