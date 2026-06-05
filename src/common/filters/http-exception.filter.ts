import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";

import { errorEnvelope } from "../dto/api-envelope.dto";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_ERROR";
    let message = "Something went wrong";
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "object" && body !== null) {
        const record = body as Record<string, unknown>;
        message =
          typeof record.message === "string"
            ? record.message
            : Array.isArray(record.message)
              ? record.message.join(", ")
              : message;
        code =
          typeof record.code === "string"
            ? record.code
            : status === HttpStatus.UNAUTHORIZED
              ? "UNAUTHORIZED"
              : status === HttpStatus.FORBIDDEN
                ? "FORBIDDEN"
                : status === HttpStatus.NOT_FOUND
                  ? "NOT_FOUND"
                  : "VALIDATION_ERROR";
        details =
          typeof record.details === "object"
            ? (record.details as Record<string, unknown>)
            : undefined;
      } else if (typeof body === "string") {
        message = body;
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    response.status(status).json(errorEnvelope(code, message, details));
  }
}
