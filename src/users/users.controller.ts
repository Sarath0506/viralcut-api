import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { memoryStorage } from "multer";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthJwtPayload } from "../auth/auth.types";
import { ObjectStorageService } from "../storage/object-storage.service";
import { UsersService } from "./users.service";
import { UserMeDto } from "./dto/user-me.dto";

@ApiTags("users")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("users")
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly storage: ObjectStorageService,
  ) {}

  @Get("me")
  @ApiOkResponse({ type: UserMeDto })
  getMe(@CurrentUser() user: AuthJwtPayload) {
    return this.users.getMe(user.sub, user.role);
  }

  @Patch("me/brand-profile")
  updateBrandProfile(
    @CurrentUser() user: AuthJwtPayload,
    @Body() body: { companyName?: string; displayName?: string; logoUrl?: string },
  ) {
    return this.users.updateBrandProfile(user.sub, body);
  }

  @Post("me/brand-logo")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadBrandLogo(
    @Req() req: import("express").Request,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const result = await this.storage.saveUploadedFile("brand-logos", {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
    const url = result.url.startsWith("http")
      ? result.url
      : `${req.protocol}://${req.get("host")}${result.url}`;
    return { url };
  }
}
