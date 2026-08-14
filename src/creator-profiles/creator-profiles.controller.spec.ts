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

describe("CreatorProfilesController social connect (Apify-based)", () => {
  it("connects Instagram via handle", () => {
    const { controller, user, profiles } = makeController();
    profiles.connectSocial.mockReturnValue({ platform: "instagram" });

    expect(controller.connectSocial(user, "profile-1", "instagram", "@handle")).toEqual({
      platform: "instagram",
    });
    expect(profiles.connectSocial).toHaveBeenCalledWith(
      "user-1",
      "profile-1",
      "instagram",
      "@handle",
    );
  });

  it("connects YouTube via handle", () => {
    const { controller, user, profiles } = makeController();
    profiles.connectSocial.mockReturnValue({ platform: "youtube" });

    expect(controller.connectSocial(user, "profile-1", "youtube", "channel")).toEqual({
      platform: "youtube",
    });
    expect(profiles.connectSocial).toHaveBeenCalledWith(
      "user-1",
      "profile-1",
      "youtube",
      "channel",
    );
  });

  it("connects Twitter via handle", () => {
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

  it("disconnects Instagram and YouTube through the same Apify-based path, not OAuth services", () => {
    const { controller, user, profiles, instagramOAuth, youtubeOAuth } = makeController();
    profiles.disconnectSocial.mockImplementation((_userId, _profileId, platform) => ({
      platform,
    }));

    expect(controller.disconnectSocial(user, "profile-1", "instagram")).toEqual({
      platform: "instagram",
    });
    expect(controller.disconnectSocial(user, "profile-1", "youtube")).toEqual({
      platform: "youtube",
    });
    expect(profiles.disconnectSocial).toHaveBeenCalledWith("user-1", "profile-1", "instagram");
    expect(profiles.disconnectSocial).toHaveBeenCalledWith("user-1", "profile-1", "youtube");
    expect(instagramOAuth.disconnect).not.toHaveBeenCalled();
    expect(youtubeOAuth.disconnect).not.toHaveBeenCalled();
  });
});
