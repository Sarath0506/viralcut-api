import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { TaskStatus, UserRole } from "@prisma/client";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { CreateTaskDto, UpdateTaskStatusDto } from "./dto/task.dto";
import { TasksService } from "./tasks.service";

@ApiTags("tasks")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post("admin/tasks")
  @Roles(UserRole.admin)
  createTask(@CurrentUser() user: AuthJwtPayload, @Body() dto: CreateTaskDto) {
    return this.tasks.createTask(user.sub, dto);
  }

  @Get("admin/tasks")
  @Roles(UserRole.admin)
  listTasks(@Query("staffId") staffId?: string, @Query("status") status?: TaskStatus) {
    return this.tasks.listTasks({ staffId, status });
  }

  @Delete("admin/tasks/:id")
  @Roles(UserRole.admin)
  deleteTask(@Param("id") id: string) {
    return this.tasks.deleteTask(id);
  }

  @Get("staff/tasks")
  @Roles(UserRole.staff)
  listMyTasks(@CurrentUser() user: AuthJwtPayload) {
    return this.tasks.listTasksForStaff(user.sub);
  }

  @Patch("staff/tasks/:id/status")
  @Roles(UserRole.staff)
  updateMyTaskStatus(
    @CurrentUser() user: AuthJwtPayload,
    @Param("id") id: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.tasks.updateStatusAsStaff(user.sub, id, dto.status);
  }
}
