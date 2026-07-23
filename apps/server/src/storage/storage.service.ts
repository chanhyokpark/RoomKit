import type { Readable } from 'node:stream';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

export const PRESIGN_EXPIRES_IN = 600;

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  /**
   * Client bound to S3_PUBLIC_ENDPOINT, used only to sign URLs handed to
   * browsers/devices. SigV4 binds the signature to the host, so presigned
   * URLs must be signed against the endpoint clients actually fetch from.
   */
  private readonly s3Public: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    const clientConfig = {
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      },
    };
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    const publicEndpoint =
      config.get('S3_PUBLIC_ENDPOINT', { infer: true }) ?? endpoint;
    this.s3 = new S3Client({ ...clientConfig, endpoint });
    this.s3Public =
      publicEndpoint === endpoint
        ? this.s3
        : new S3Client({ ...clientConfig, endpoint: publicEndpoint });
  }

  /** The upload must send the exact contentType signed here. */
  presignPut(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.s3Public,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: PRESIGN_EXPIRES_IN },
    );
  }

  presignGet(key: string, expiresIn = PRESIGN_EXPIRES_IN): Promise<string> {
    return getSignedUrl(
      this.s3Public,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  /** Streaming upload; handles unknown length via multipart. */
  async putStream(
    key: string,
    body: Readable,
    contentType: string,
  ): Promise<void> {
    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      },
    });
    await upload.done();
  }

  /** All object keys under a prefix (paginated). */
  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      continuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys;
  }

  async getStream(key: string): Promise<{
    body: Readable;
    contentType?: string;
    contentLength?: number;
    etag?: string;
  }> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        body: res.Body as Readable,
        contentType: res.ContentType,
        contentLength: res.ContentLength,
        etag: res.ETag,
      };
    } catch (err) {
      if (err instanceof NoSuchKey) {
        throw new NotFoundException(`Object ${key} not found`);
      }
      throw err;
    }
  }
}
