import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ApiErrorDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional()
  details?: Record<string, unknown>;
}

export class ApiEnvelopeDto<T> {
  @ApiProperty()
  success!: boolean;

  @ApiPropertyOptional({ nullable: true })
  data!: T | null;

  @ApiPropertyOptional({ type: ApiErrorDto, nullable: true })
  error!: ApiErrorDto | null;
}

export function successEnvelope<T>(data: T): ApiEnvelopeDto<T> {
  return { success: true, data, error: null };
}

export function errorEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiEnvelopeDto<null> {
  return {
    success: false,
    data: null,
    error: { code, message, details },
  };
}
