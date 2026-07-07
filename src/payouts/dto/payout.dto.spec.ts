import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";

import { CreatePayoutMethodDto } from "./payout.dto";

describe("CreatePayoutMethodDto", () => {
  it("requires a valid IFSC code for bank accounts", async () => {
    const dto = plainToInstance(CreatePayoutMethodDto, {
      type: "bank",
      label: "HDFC Bank",
      accountHolderName: "Ravi Kumar",
      account: "1234567890",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "ifscCode")).toBe(true);
  });

  it("accepts a well-formed IFSC code for bank accounts", async () => {
    const dto = plainToInstance(CreatePayoutMethodDto, {
      type: "bank",
      label: "HDFC Bank",
      accountHolderName: "Ravi Kumar",
      account: "1234567890",
      ifscCode: "HDFC0001234",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "ifscCode")).toBe(false);
  });

  it("rejects a malformed IFSC code", async () => {
    const dto = plainToInstance(CreatePayoutMethodDto, {
      type: "bank",
      label: "HDFC Bank",
      accountHolderName: "Ravi Kumar",
      account: "1234567890",
      ifscCode: "not-an-ifsc",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "ifscCode")).toBe(true);
  });

  it("does not require an IFSC code for UPI methods", async () => {
    const dto = plainToInstance(CreatePayoutMethodDto, {
      type: "upi",
      label: "Personal UPI",
      accountHolderName: "Ravi Kumar",
      account: "ravi@upi",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "ifscCode")).toBe(false);
  });

  it("requires an account holder name", async () => {
    const dto = plainToInstance(CreatePayoutMethodDto, {
      type: "upi",
      label: "Personal UPI",
      accountHolderName: "",
      account: "ravi@upi",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "accountHolderName")).toBe(true);
  });
});
