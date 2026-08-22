import fs from "node:fs";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import type { Response } from "express";
import mime from "mime-types";
import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { env } from "../env.js";

// Optional offload for *finished* recordings — see recorder.ts's
// finishRecording. Recording itself is always local-first regardless of any
// of this (yt-dlp/ffmpeg need a real filesystem path to write a growing
// live file to, and an object store isn't one), so this module only ever
// deals with a file that's already complete and sitting on disk.
//
// Deliberately generic "S3-compatible" rather than AWS-specific: the same
// client works against real AWS S3, self-hosted MinIO, R2, B2, etc. by just
// pointing S3_ENDPOINT + S3_FORCE_PATH_STYLE at whichever one — see env.ts.

export function isEnabled(): boolean {
  return Boolean(env.s3Bucket && env.s3AccessKeyId && env.s3SecretAccessKey);
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint || undefined,
      forcePathStyle: env.s3ForcePathStyle,
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    });
  }
  return client;
}

export function keyFor(fileName: string): string {
  return `${env.s3KeyPrefix}${fileName}`;
}

/** Uploads a local file already on disk, then confirms it actually landed
 * intact before reporting success — the caller (recorder.ts's
 * offloadToS3) only deletes the local copy, the only *other* copy that
 * exists, once this returns true, so "the SDK call didn't throw" isn't
 * quite enough to trust on its own. Uses lib-storage's Upload (not a plain
 * PutObjectCommand) specifically so a long recording past S3's 5GB
 * single-PUT limit still works — it transparently switches to a multipart
 * upload for anything large enough to need one. Best-effort: false on any
 * failure (network, credentials, bucket missing, size mismatch, etc.)
 * rather than throwing — a failed offload should leave the recording
 * exactly as it was (local, unmodified), not half-broken. */
export async function uploadFile(localAbsPath: string, fileName: string): Promise<boolean> {
  if (!isEnabled()) return false;
  try {
    const localSize = (await stat(localAbsPath)).size;

    const upload = new Upload({
      client: getClient(),
      params: {
        Bucket: env.s3Bucket,
        Key: keyFor(fileName),
        Body: fs.createReadStream(localAbsPath),
        // Without this, GetObject on playback falls back to
        // application/octet-stream — most browsers won't play that inline
        // in a <video> tag, they'll just offer it as a download instead.
        ContentType: mime.lookup(fileName) || "application/octet-stream",
      },
    });
    await upload.done();

    // Confirmation, not just optimism: a fresh HeadObject against the
    // bucket itself (not whatever the SDK's local bookkeeping believes),
    // checked against the size actually on disk. A mismatch (truncated
    // upload, a stale object already sitting at that key from something
    // else, etc.) is treated the same as an outright failure.
    const head = await getClient().send(new HeadObjectCommand({ Bucket: env.s3Bucket, Key: keyFor(fileName) }));
    if (head.ContentLength !== localSize) {
      console.error(
        `[s3] upload verification failed for ${fileName}: local file is ${localSize} bytes, S3 reports ${head.ContentLength}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[s3] upload failed for ${fileName}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Best-effort — same reasoning as storage.deleteFile: an already-gone (or
 * never-uploaded) object is fine, not an error worth surfacing. */
export async function deleteObject(fileName: string): Promise<void> {
  if (!isEnabled()) return;
  try {
    await getClient().send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: keyFor(fileName) }));
  } catch (err) {
    console.error(`[s3] delete failed for ${fileName}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Proxies a GET (with optional Range passthrough, for seeking/resumable
 * download) straight from the bucket to the Express response — the app
 * server sits between the browser and the bucket rather than handing back a
 * presigned URL, so play/download keeps working even when the bucket
 * endpoint (e.g. a self-hosted MinIO reachable only from the server's own
 * network) isn't reachable from the browser itself.
 */
export async function streamObject(
  fileName: string,
  rangeHeader: string | undefined,
  res: Response
): Promise<void> {
  try {
    const result = await getClient().send(
      new GetObjectCommand({ Bucket: env.s3Bucket, Key: keyFor(fileName), Range: rangeHeader })
    );
    const body = result.Body as Readable | undefined;
    if (!body) {
      res.status(502).end();
      return;
    }
    res.status(rangeHeader && result.ContentRange ? 206 : 200);
    res.setHeader("Accept-Ranges", "bytes");
    if (result.ContentType) res.setHeader("Content-Type", result.ContentType);
    if (result.ContentLength !== undefined) res.setHeader("Content-Length", String(result.ContentLength));
    if (result.ContentRange) res.setHeader("Content-Range", result.ContentRange);
    body.on("error", () => res.destroy());
    body.pipe(res);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "NoSuchKey") {
      res.status(404).end();
      return;
    }
    console.error(`[s3] stream failed for ${fileName}:`, err instanceof Error ? err.message : err);
    res.status(502).end();
  }
}
