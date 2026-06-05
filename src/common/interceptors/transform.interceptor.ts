import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, map } from "rxjs";

import { successEnvelope } from "../dto/api-envelope.dto";

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (
          data !== null &&
          typeof data === "object" &&
          "success" in (data as object)
        ) {
          return data;
        }
        return successEnvelope(data);
      }),
    );
  }
}
