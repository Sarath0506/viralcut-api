import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { TaskStatus, UserRole } from "@prisma/client";

import { ActivityLogService } from "../activity/activity-log.service";
import { InAppNotificationService } from "../notifications/in-app-notification.service";
import { PrismaService } from "../prisma/prisma.service";

function formatTask(task: {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignedTo: { id: string; displayName: string | null; email: string | null };
  brandProfile: { id: string; companyName: string } | null;
}) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: task.dueDate?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    assignedTo: {
      id: task.assignedTo.id,
      name: task.assignedTo.displayName ?? task.assignedTo.email ?? "Team member",
    },
    brand: task.brandProfile ? { id: task.brandProfile.id, companyName: task.brandProfile.companyName } : null,
  };
}

const taskInclude = {
  assignedTo: { select: { id: true, displayName: true, email: true } },
  brandProfile: { select: { id: true, companyName: true } },
} as const;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly notifications: InAppNotificationService,
  ) {}

  async createTask(actorUserId: string, dto: {
    title: string;
    description?: string;
    assignedToUserId: string;
    brandProfileId?: string;
    dueDate?: string;
  }) {
    const assignee = await this.prisma.user.findUnique({ where: { id: dto.assignedToUserId } });
    if (!assignee || assignee.role !== UserRole.staff) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Team member not found" });
    }

    const task = await this.prisma.task.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || undefined,
        assignedToUserId: dto.assignedToUserId,
        createdByUserId: actorUserId,
        brandProfileId: dto.brandProfileId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
      include: taskInclude,
    });

    await this.activityLog.log(dto.assignedToUserId, "task.assigned", {
      targetType: "Task",
      targetId: task.id,
      brandProfileId: dto.brandProfileId,
      metadata: { title: task.title },
    });

    await this.notifications.create(dto.assignedToUserId, "staff", {
      type: "task.assigned",
      title: "New task assigned",
      body: task.title,
      link: "/staff/tasks",
    });

    return formatTask(task);
  }

  async listTasks(filters?: { staffId?: string; status?: TaskStatus }) {
    const tasks = await this.prisma.task.findMany({
      where: {
        assignedToUserId: filters?.staffId,
        status: filters?.status,
      },
      include: taskInclude,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    });
    return tasks.map(formatTask);
  }

  async listTasksForStaff(staffUserId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { assignedToUserId: staffUserId },
      include: taskInclude,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    });
    return tasks.map(formatTask);
  }

  async updateStatusAsStaff(staffUserId: string, taskId: string, status: TaskStatus) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Task not found" });
    }
    if (task.assignedToUserId !== staffUserId) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "Not your task" });
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { status },
      include: taskInclude,
    });

    if (status === TaskStatus.done) {
      await this.activityLog.log(staffUserId, "task.completed", {
        targetType: "Task",
        targetId: task.id,
        brandProfileId: task.brandProfileId ?? undefined,
        metadata: { title: task.title },
      });

      await this.notifications.notifyAllAdmins({
        type: "task.completed",
        title: "Task completed",
        body: task.title,
      });
    }

    return formatTask(updated);
  }

  async deleteTask(taskId: string) {
    await this.prisma.task.delete({ where: { id: taskId } }).catch(() => {
      throw new NotFoundException({ code: "NOT_FOUND", message: "Task not found" });
    });
    return { deleted: true };
  }
}
