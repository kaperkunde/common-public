import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/**
 * Sealing a secret so the database holds something only this server can
 * open: AES-256-GCM, a fresh random IV each time, under a key from the
 * environment (base64 of 32 bytes). GCM's tag makes a tampered value refuse
 * to open rather than open into something else. The sealed form is
 * `v1:<iv>:<tag>:<ciphertext>`, each part base64; the version is how the key
 * is ever rotated, and a version this code does not know is refused rather
 * than guessed at. A label is bound in as additional data, so a value sealed
 * for one purpose cannot be handed in as another's.
 *
 * Nothing here logs, and no error carries the plaintext or the key.
 */

export const SEAL_VERSION = "v1"

const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SecretBoxError"
  }
}

/** Whether a stored value looks like one this box sealed (any version). */
export function isSealed(value: string): boolean {
  return /^v\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/.test(value)
}

/**
 * A box over the key in `env[keyVariable]`. `label` names what the values
 * are sealed for (`"plekje:spot-credentials"`): opening under another label
 * fails.
 */
export function createSecretBox({
  keyVariable,
  label,
  env = process.env,
}: {
  keyVariable: string
  label: string
  env?: Record<string, string | undefined>
}) {
  function key(): Buffer {
    const raw = env[keyVariable]?.trim()
    if (!raw) {
      throw new SecretBoxError(
        `${keyVariable} is not set. Set it to the base64 of ${KEY_BYTES} random bytes (openssl rand -base64 ${KEY_BYTES}).`,
      )
    }
    const bytes = Buffer.from(raw, "base64")
    if (bytes.length !== KEY_BYTES) {
      throw new SecretBoxError(
        `${keyVariable} must be the base64 of ${KEY_BYTES} bytes; it decodes to ${bytes.length}.`,
      )
    }
    return bytes
  }

  return {
    /** Whether a key is configured at all, for a screen that would otherwise fail. */
    configured(): boolean {
      try {
        key()
        return true
      } catch {
        return false
      }
    },

    /** Seals a secret. Every call gives a different answer for the same input. */
    seal(plaintext: string): string {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv("aes-256-gcm", key(), iv, {
        authTagLength: TAG_BYTES,
      })
      cipher.setAAD(Buffer.from(label, "utf8"))
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ])
      return [SEAL_VERSION, iv, cipher.getAuthTag(), ciphertext]
        .map((part) =>
          typeof part === "string" ? part : part.toString("base64"),
        )
        .join(":")
    },

    /**
     * Opens a sealed value. Refuses a version it does not know, a value not
     * in the shape it wrote, and, through the tag, one changed by a single
     * bit or sealed under another key or label.
     */
    open(sealed: string): string {
      const parts = sealed.split(":")
      const version = parts[0] ?? ""
      if (version !== SEAL_VERSION) {
        const named = /^v\d+$/.test(version)
          ? `version ${version}`
          : "an unknown version"
        throw new SecretBoxError(
          `A value sealed under ${named} cannot be opened here.`,
        )
      }
      const [, ivText = "", tagText = "", ciphertextText = ""] = parts
      const iv = Buffer.from(ivText, "base64")
      const tag = Buffer.from(tagText, "base64")
      if (
        parts.length !== 4 ||
        iv.length !== IV_BYTES ||
        tag.length !== TAG_BYTES
      ) {
        throw new SecretBoxError(
          "That sealed value is not in the shape it was sealed in.",
        )
      }
      const decipher = createDecipheriv("aes-256-gcm", key(), iv, {
        authTagLength: TAG_BYTES,
      })
      decipher.setAAD(Buffer.from(label, "utf8"))
      decipher.setAuthTag(tag)
      try {
        return Buffer.concat([
          decipher.update(Buffer.from(ciphertextText, "base64")),
          decipher.final(),
        ]).toString("utf8")
      } catch {
        throw new SecretBoxError(
          "That sealed value could not be opened: it was changed, or sealed under another key.",
        )
      }
    },
  }
}

/** The last four characters of a secret, which is all a screen ever shows of it. */
export function lastFour(secret: string): string {
  return secret.trim().slice(-4)
}

/**
 * Text with secrets taken out, for an error that might have echoed one back:
 * every named secret wherever it appears, anything shaped like a bearer
 * token or an `sk-` key, and anything shaped like a sealed value.
 */
export function redact(
  text: string,
  secrets: readonly (string | undefined | null)[] = [],
): string {
  const named = secrets
    .filter((s): s is string => typeof s === "string" && s.trim().length >= 4)
    .map((s) => s.trim())
    .sort((a, b) => b.length - a.length)
  const without = named.reduce((so, s) => so.split(s).join("[redacted]"), text)
  return without
    .replace(/(bearer\s+)[^\s"',]+/gi, "$1[redacted]")
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(
      /v\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/g,
      "[redacted]",
    )
}
