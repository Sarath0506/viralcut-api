import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<{
    status: string;
    timestamp: string;
    database: string;
  }> {
    let database = "ok";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "error";
    }

    return {
      status: database === "ok" ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      database,
    };
  }
}
