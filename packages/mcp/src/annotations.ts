import type { ToolAnnotations } from "./define"

/**
 * A tool's four annotations from its class of action, so a new tool is
 * classified the same way as the ones next to it (plek.je's rule):
 *
 * - `write`: it changes something. A read is read only, never destructive
 *   and always idempotent, whatever else it says.
 * - `destructive`: it overwrites, replaces, removes or revokes existing
 *   data or access, whether or not it can be undone (being able to undo it
 *   does not make it safe). Every update, delete, removal, bulk edit,
 *   sign-out, regenerated key and replaced file is destructive; only purely
 *   additive writes are not: creating, drafting, copying, uploading a new
 *   file, sending a test to the owner. A create that can replace something
 *   counts as destructive, and so does a send to people, which cannot be
 *   taken back. A proposal that only asks the owner (nothing is written
 *   until they agree) is not destructive.
 * - `idempotent`: calling it twice with the same arguments does no more
 *   than calling it once.
 * - `openWorld`: it sends email, publishes to a public site or to people's
 *   inboxes, or reaches a third party (payments, an outside URL, a chat
 *   service).
 */
export type ActionClass = {
  write: boolean
  destructive?: boolean
  idempotent?: boolean
  openWorld?: boolean
}

export function annotationsFor({
  write,
  destructive,
  idempotent,
  openWorld,
}: ActionClass): ToolAnnotations {
  return {
    readOnlyHint: !write,
    destructiveHint: write ? destructive === true : false,
    idempotentHint: write ? idempotent === true : true,
    openWorldHint: openWorld === true,
  }
}
