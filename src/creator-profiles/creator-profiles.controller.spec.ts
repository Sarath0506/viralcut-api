import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { CreatorProfilesController } from "./creator-profiles.controller";

function makeController() {
  const profiles = {
    connectSocial: vi.fn(),
    disconnectSocial: vi.fn(),
  };
  const instagramOAuth = {
    start: vi.fn(),
    complete: vi.fn(),
    disconnect: vi.fn(),
  };
  const youtubeOAuth = {
    authUrl: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const controller = new CreatorProfilesController(
    profiles as never,
    instagramOAuth as never,
    youtubeOAuth as never,
  );
  const user = { sub: "user-1" } as never;
  return { controller, profiles, instagramOAuth, youtubeOAuth, user };
}

describe("CreatorProfilesController social OAuth cleanup", () => {
  it("rejects manual Instagram connect", () => {
    const { controller, user, profiles } = makeController();

    expect(() =>
      controller.connectSocial(user, "profile-1", "instagram", "handle"),
    ).toThrow(BadRequestException);
    expect(profiles.connectSocial).not.toHaveBeenCalled();
  });

  it("rejects manual YouTube connect", () => {
    const { controller, user, profiles } = makeController();

    expect(() =>
      controller.connectSocial(user, "profile-1", "youtube", "channel"),
    ).toThrow(BadRequestException);
    expect(profiles.connectSocial).not.toHaveBeenCalled();
  });

  it("keeps manual Twitter connect", () => {
    const { controller, user, profiles } = makeController();
    profiles.connectSocial.mockReturnValue({ platform: "twitter" });

    expect(controller.connectSocial(user, "profile-1", "twitter", "@x")).toEqual({
      platform: "twitter",
    });
    expect(profiles.connectSocial).toHaveBeenCalledWith(
      "user-1",
      "profile-1",
      "twitter",
      "@x",
    );
  });

  it("routes Instagram and YouTube disconnect through OAuth services", () => {
    const { controller, user, profiles, instagramOAuth, youtubeOAuth } =
      makeController();
    instagramOAuth.disconnect.mockReturnValue({ platform: "instagram" });
    youtubeOAuth.disconnect.mockReturnValue({ platform: "youtube" });

    expect(controller.disconnectSocial(user, "profile-1", "instagram")).toEqual({
      platform: "instagram",
    });
    expect(controller.disconnectSocial(user, "profile-1", "youtube")).toEqual({
      platform: "youtube",
    });
    expect(profiles.disconnectSocial).not.toHaveBeenCalled();
  });
});
