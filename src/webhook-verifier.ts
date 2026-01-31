import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify a VeilMail webhook signature using HMAC-SHA256.
 *
 * VeilMail signs webhook payloads with HMAC-SHA256 using your webhook secret.
 * The signature is sent in the `x-veilmail-signature` header as a hex-encoded string.
 *
 * @param payload - The raw request body string.
 * @param signature - The signature from the `x-veilmail-signature` header.
 * @param secret - Your webhook signing secret.
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!payload || !signature || !secret) {
    return false
  }

  try {
    const expected = createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex')

    const signatureBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expected, 'hex')

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer)
  } catch {
    return false
  }
}
