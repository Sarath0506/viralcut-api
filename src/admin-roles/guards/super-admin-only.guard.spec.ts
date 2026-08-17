import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { SuperAdminOnlyGuard } from "./super-admin-only.guard";

function makeContext(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(isSuperAdmin: boolean) {
  const adminRoles = {
    getEffectivePermissions: vi.fn().mockResolvedValue({ isSuperAdmin, canSeeMoney: isSuperAdmin, sections: {} }),
  };
  return new SuperAdminOnlyGuard(adminRoles as never);
}

describe("SuperAdminOnlyGuard", () => {
  it("allows a Super Admin through", async () => {
    const guard = makeGuard(true);
    await expect(guard.canActivate(makeContext({ sub: "u1" }))).resolves.toBe(true);
  });

  it("blocks a restricted admin, even one with manage everywhere", async () => {
    const guard = makeGuard(false);
    await expect(guard.canActivate(makeContext({ sub: "u1" }))).rejects.toThrow(ForbiddenException);
  });
});
