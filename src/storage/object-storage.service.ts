import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Env } from "../config/env";
import { ensureUploadDir, uploadFilename } from "../common/upload.util";

export type UploadedFilePayload = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

export type StoredUploadResult = {
  url: string;
  path: string;
  name: string;
};

@Injectable()
export class ObjectStorageService {
  private readonly s3Client: S3Client | null;

  constructor(private readonly config: ConfigService<Env, true>) {
    if (this.isR2Configured()) {
      this.s3Client = new S3Client({
        region: this.config.get("S3_REGION", { infer: true }),
        endpoint: this.config.get("S3_ENDPOINT", { infer: true }),
        credentials: {
          accessKeyId: this.config.get("S3_ACCESS_KEY_ID", { infer: true }),
          secretAccessKey: this.config.get("S3_SECRET_ACCESS_KEY", { infer: true }),
        },
      });
      return;
    }

    this.s3Client = null;
  }

  isR2Configured(): boolean {
    return Boolean(
      this.config.get("S3_ENDPOINT", { infer: true }) &&
        this.config.get("S3_BUCKET", { infer: true }) &&
        this.config.get("S3_ACCESS_KEY_ID", { infer: true }) &&
        this.config.get("S3_SECRET_ACCESS_KEY", { infer: true }) &&
        this.config.get("S3_PUBLIC_BASE_URL", { infer: true }),
    );
  }

  async saveUploadedFile(
    folder: string,
    file: UploadedFilePayload,
  ): Promise<StoredUploadResult> {
    const filename = uploadFilename(file.originalname, file.mimetype);
    const key = `${folder}/${filename}`;

    if (this.isR2Configured()) {
      await this.uploadToR2(key, file.buffer, file.mimetype);
      return buildR2UploadResponse(
        this.config.get("S3_PUBLIC_BASE_URL", { infer: true }),
        key,
        file.originalname,
      );
    }

    return this.saveToLocalDisk(folder, filename, file);
  }

  private async uploadToR2(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    if (!this.s3Client) {
      throw new InternalServerErrorException("Object storage is not configured");
    }

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.config.get("S3_BUCKET", { infer: true }),
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (error) {
      throw new InternalServerErrorException("Failed to upload file to object storage", {
        cause: error,
      });
    }
  }

  private saveToLocalDisk(
    folder: string,
    filename: string,
    file: UploadedFilePayload,
  ): StoredUploadResult {
    const dir = ensureUploadDir(folder);
    writeFileSync(join(dir, filename), file.buffer);

    const path = `/uploads/${folder}/${filename}`;
    return {
      url: path,
      path,
      name: file.originalname,
    };
  }
}

export function buildR2UploadResponse(
  publicBaseUrl: string,
  key: string,
  originalname: string,
): StoredUploadResult {
  const url = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
  return {
    url,
    path: url,
    name: originalname,
  };
}
