import { HttpException, HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { HttpExceptionFilter } from "./http-exception.filter";

describe("HttpExceptionFilter", () => {
  it("maps HTTP 429 to RATE_LIMITED when no explicit code is set", () => {
    const filter = new HttpExceptionFilter();
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    };

    filter.catch(
      new HttpException("Too Many Requests", HttpStatus.TOO_MANY_REQUESTS),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: "RATE_LIMITED",
          message: "Too Many Requests",
        }),
      }),
    );
  });
});
