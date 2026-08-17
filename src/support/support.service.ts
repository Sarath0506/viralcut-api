import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { SupportTicketStatus } from "@prisma/client";

import { InAppNotificationService } from "../notifications/in-app-notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";

function formatTicket(ticket: {
  id: string;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: ticket.id,
    subject: ticket.subject,
    message: ticket.message,
    status: ticket.status,
    resolutionNote: ticket.resolutionNote,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: InAppNotificationService,
    private readonly realtime: RealtimeService,
  ) {}

  async createTicket(creatorId: string, dto: { subject: string; message: string }) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        creatorId,
        subject: dto.subject.trim(),
        message: dto.message.trim(),
      },
    });

    await this.notifications.notifyAllAdmins({
      type: "support_ticket.created",
      title: "New support ticket",
      body: ticket.subject,
      link: `/admin/support-tickets/${ticket.id}`,
    });

    return formatTicket(ticket);
  }

  async listMyTickets(creatorId: string) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { creatorId },
      orderBy: { createdAt: "desc" },
    });
    return tickets.map(formatTicket);
  }

  async listAllTickets(status?: SupportTicketStatus) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { status },
      include: {
        creator: {
          select: { id: true, displayName: true, username: true, email: true, phone: true, avatarUrl: true },
        },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return tickets.map((t) => ({
      ...formatTicket(t),
      creator: {
        id: t.creator.id,
        displayName: t.creator.displayName,
        username: t.creator.username,
        email: t.creator.email,
        phone: t.creator.phone,
        avatarUrl: t.creator.avatarUrl,
      },
    }));
  }

  async getTicketDetail(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            username: true,
            email: true,
            phone: true,
            avatarUrl: true,
            kycStatus: true,
            createdAt: true,
          },
        },
      },
    });
    if (!ticket) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Ticket not found" });
    }
    return {
      ...formatTicket(ticket),
      creator: {
        id: ticket.creator.id,
        displayName: ticket.creator.displayName,
        username: ticket.creator.username,
        email: ticket.creator.email,
        phone: ticket.creator.phone,
        avatarUrl: ticket.creator.avatarUrl,
        kycStatus: ticket.creator.kycStatus,
        createdAt: ticket.creator.createdAt.toISOString(),
      },
    };
  }

  async respondToTicket(ticketId: string, action: "investigating" | "resolved", note: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Ticket not found" });
    }
    if (ticket.status !== SupportTicketStatus.under_investigation) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "Ticket is already resolved" });
    }

    const resolving = action === "resolved";
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: resolving ? SupportTicketStatus.resolved : SupportTicketStatus.under_investigation,
        resolutionNote: note.trim(),
        resolvedAt: resolving ? new Date() : null,
      },
    });

    this.realtime.emitSupportTicketUpdated(ticket.creatorId, updated.id);

    await this.notifications.create(ticket.creatorId, "creator", {
      type: resolving ? "support_ticket.resolved" : "support_ticket.updated",
      title: resolving ? "Your support ticket was resolved" : "Update on your support ticket",
      body: updated.resolutionNote ?? updated.subject,
      link: "/support/raise-ticket",
    });

    return formatTicket(updated);
  }
}
