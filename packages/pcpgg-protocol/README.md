# @kaperkunde/pcpgg-protocol

[pcp.gg](https://pcp.gg)'s tunnel, shared by the relay (in pcp.gg) and the
connector that runs inside [PCP](https://github.com/kaperkunde/pcp).

| Import                                 | What it is                                                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kaperkunde/pcpgg-protocol`           | The wire protocol: frames, the stream multiplexer, the control messages, `PROTOCOL_VERSION`                                                                            |
| `@kaperkunde/pcpgg-protocol/connector` | `startConnector`: dials out to the relay and answers each connection by dialling PCP. No dependencies beyond Node 24; a target may be a function, looked up per stream |
| `@kaperkunde/pcpgg-protocol/relay`     | `createRelay`: routes encrypted connections by name (SNI) without terminating TLS, answers ACME HTTP-01 challenges, and asks a `Directory` whose key is whose          |

The relay's `Directory` (how the pcp.gg app is reached, and with what secret)
stays with the app: this package holds only the interface.

## Rules this code keeps

pcp.gg promises it cannot read what passes between an assistant and an
owner's PCP. The relay therefore never terminates TLS for an owner's name,
port 80 forwards only the ACME challenge, and nothing logs a connection's
address or bytes. A change that touches any of that changes pcp.gg's
`/security` page and privacy notice in the same release.

A protocol change bumps `PROTOCOL_VERSION`, gets a test here, and is a major
version of this package: PCP and pcp.gg take it together.
