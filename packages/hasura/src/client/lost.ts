/**
 * Whether an error is the live connection going away rather than anything
 * about the question that was asked.
 *
 * Apollo's `GraphQLWsLink` turns a closed websocket into an `Error` whose
 * message starts `Socket closed`; an `ApolloError` carrying it as its network
 * error repeats the text. Only the socket counts: a failed query over HTTP
 * belongs beside the form that asked.
 */
export type ConnectionError =
  | {
      message?: string | null
      networkError?: { message?: string | null } | null
    }
  | null
  | undefined

const closed = (message?: string | null) =>
  typeof message === "string" && message.startsWith("Socket closed")

/** True for the socket's own error and for an `ApolloError` wrapping one. */
export const isConnectionLost = (error?: ConnectionError): boolean =>
  closed(error?.message) || closed(error?.networkError?.message)
