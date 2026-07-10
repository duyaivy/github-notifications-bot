import crypto from "node:crypto";

const signaturePrefix = "sha256=";

export function verifyGitHubSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader.startsWith(signaturePrefix)) {
    return false;
  }

  const receivedHex = signatureHeader.slice(signaturePrefix.length);
  if (!/^[a-fA-F0-9]{64}$/.test(receivedHex)) {
    return false;
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(receivedHex, "hex");

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
