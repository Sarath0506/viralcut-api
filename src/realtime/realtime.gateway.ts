import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { UserRole } from "@prisma/client";
import type { Server, Socket } from "socket.io";

import type { Env } from "../config/env";
import type { AuthJwtPayload } from "../auth/auth.types";
import { CampaignAccessService } from "../access/campaign-access.service";

@WebSocketGateway({
  namespace: "/realtime",
  cors: {
    origin: process.env.CORS_ORIGINS?.split(",").map((o) => o.trim()) ?? true,
    credentials: true,
  },
})
@Injectable()
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly campaignAccess: CampaignAccessService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.headers.authorization?.replace(/^Bearer\s+/i, "") ??
          undefined);

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = await this.jwt.verifyAsync<AuthJwtPayload>(token, {
        secret: this.config.get("JWT_SECRET", { infer: true }),
      });

      client.data.userId = payload.sub;
      client.data.role = payload.role;

      if (payload.role === UserRole.admin) {
        await client.join("admin");
      }

      if (payload.role === UserRole.brand) {
        const brandProfileId =
          await this.campaignAccess.getBrandProfileIdForUser(payload.sub);
        if (brandProfileId) {
          client.data.brandProfileId = brandProfileId;
          await client.join(`brand:${brandProfileId}`);
        }
      }

      if (payload.role === UserRole.creator) {
        await client.join(`creator:${payload.sub}`);
      }

      this.logger.debug(`Client connected: ${client.id} (${payload.role})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage("campaign:join")
  async handleJoinCampaign(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { campaignId?: string },
  ): Promise<void> {
    if (body.campaignId) {
      await client.join(`campaign:${body.campaignId}`);
    }
  }

  @SubscribeMessage("campaign:leave")
  async handleLeaveCampaign(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { campaignId?: string },
  ): Promise<void> {
    if (body.campaignId) {
      await client.leave(`campaign:${body.campaignId}`);
    }
  }

  emitToAdmin(event: string, payload: unknown): void {
    this.server?.to("admin").emit(event, payload);
  }

  emitToBrand(brandProfileId: string, event: string, payload: unknown): void {
    this.server?.to(`brand:${brandProfileId}`).emit(event, payload);
  }

  emitToCampaign(campaignId: string, event: string, payload: unknown): void {
    this.server?.to(`campaign:${campaignId}`).emit(event, payload);
  }

  emitToCreator(creatorId: string, event: string, payload: unknown): void {
    this.server?.to(`creator:${creatorId}`).emit(event, payload);
  }
}
