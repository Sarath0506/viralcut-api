import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AdminSectionGuard } from "./admin-section.guard";

function makeContext(method: string, user: unknown) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(section: string | undefined, effectivePermissions: unknown) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(section) };
  const adminRoles = { getEffectivePermissions: vi.fn().mockResolvedValue(effectivePermissions) };
  const guard = new AdminSectionGuard(reflector as never, adminRoles as never);
  return { guard, adminRoles };
}

describe("AdminSectionGuard", () => {
  it("passes through routes with no @AdminSectionRoute annotation", async () => {
    const { guard } = makeGuard(undefined, { isSuperAdmin: false, canSeeMoney: false, sections: {} });
    await expect(guard.canActivate(makeContext("POST", { sub: "u1" }))).resolves.toBe(true);
  });

  it("always allows a Super Admin regardless of section value", async () => {
    const { guard } = makeGuard("tickets", { isSuperAdmin: true, canSeeMoney: true, sections: {} });
    await expect(guard.canActivate(makeContext("DELETE", { sub: "u1" }))).resolves.toBe(true);
  });

  it("blocks both reads and writes when the section is hidden", async () => {
    const { guard } = makeGuard("tickets", {
      isSuperAdmin: false,
      canSeeMoney: false,
      sections: { tickets: "hidden" },
    });
    await expect(guard.canActivate(makeContext("GET", { sub: "u1" }))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(makeContext("POST", { sub: "u1" }))).rejects.toThrow(ForbiddenException);
  });

  it("lets view-level access read but not write", async () => {
    const { guard } = makeGuard("tickets", {
      isSuperAdmin: false,
      canSeeMoney: false,
      sections: { tickets: "view" },
    });
    await expect(guard.canActivate(makeContext("GET", { sub: "u1" }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext("HEAD", { sub: "u1" }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext("PATCH", { sub: "u1" }))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(makeContext("POST", { sub: "u1" }))).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(makeContext("DELETE", { sub: "u1" }))).rejects.toThrow(ForbiddenException);
  });

  it("lets manage-level access read and write", async () => {
    const { guard } = makeGuard("tickets", {
      isSuperAdmin: false,
      canSeeMoney: false,
      sections: { tickets: "manage" },
    });
    await expect(guard.canActivate(makeContext("GET", { sub: "u1" }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext("POST", { sub: "u1" }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext("PATCH", { sub: "u1" }))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext("DELETE", { sub: "u1" }))).resolves.toBe(true);
  });

  it("checks the section the route was actually annotated with, not a neighboring one", async () => {
    const { guard } = makeGuard("brands", {
      isSuperAdmin: false,
      canSeeMoney: false,
      sections: { brands: "hidden", tickets: "manage" },
    });
    await expect(guard.canActivate(makeContext("GET", { sub: "u1" }))).rejects.toThrow(ForbiddenException);
  });
});
