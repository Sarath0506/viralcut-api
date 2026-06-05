import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../config/env";

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get("WHATSAPP_ACCESS_TOKEN") &&
        this.config.get("WHATSAPP_PHONE_NUMBER_ID") &&
        this.config.get("WHATSAPP_OTP_TEMPLATE_NAME"),
    );
  }

  private shouldLogOtpInConsole(): boolean {
    return (
      this.config.get("NODE_ENV") !== "production" ||
      this.config.get("OTP_DEV_LOG") === true
    );
  }

  private logDevOtp(phone: string, code: string, reason: string): void {
    this.logger.warn(`${reason} — OTP for ${phone}: ${code}`);
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    if (!this.isConfigured()) {
      if (this.shouldLogOtpInConsole()) {
        this.logDevOtp(phone, code, "WhatsApp not configured");
      }
      return;
    }

    try {
      await this.sendWhatsAppTemplate(phone, code);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`WhatsApp OTP failed: ${message}`);
      if (this.shouldLogOtpInConsole()) {
        this.logDevOtp(
          phone,
          code,
          "WhatsApp send failed (check template name/language in .env) — dev fallback",
        );
        return;
      }
      throw new Error("Failed to send OTP via WhatsApp");
    }
  }

  private async sendWhatsAppTemplate(phone: string, code: string): Promise<void> {
    const version = this.config.get("WHATSAPP_API_VERSION");
    const phoneNumberId = this.config.get("WHATSAPP_PHONE_NUMBER_ID");
    const token = this.config.get("WHATSAPP_ACCESS_TOKEN");
    const template = this.config.get("WHATSAPP_OTP_TEMPLATE_NAME");
    const language = this.config.get("WHATSAPP_OTP_TEMPLATE_LANGUAGE");
    const hasButton = this.config.get("WHATSAPP_OTP_TEMPLATE_HAS_BUTTON");

    const components: Array<Record<string, unknown>> = [
      {
        type: "body",
        parameters: [{ type: "text", text: code }],
      },
    ];
    if (hasButton) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: code }],
      });
    }

    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: phone.replace("+", ""),
      type: "template",
      template: {
        name: template,
        language: { code: language },
        components,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${text}`);
    }
  }
}
