# @kaperkunde/mail

Every message a Kaperkunde app sends, from one template in the app's theme.

```ts
// lib/email.ts
import { createMailer } from "@kaperkunde/mail"

export const mailer = createMailer({
  prefix: "STUDYGUILD_SMTP", // STUDYGUILD_SMTP_HOST, _PORT, _USER, _PASSWORD, _FROM, _REPLY_TO
  defaultFrom: "Study Guild <noreply@studyguild.my>",
  theme: () => studyGuildTheme(getSiteUrl()),
})

await mailer.send({
  to,
  subject: "Reset your password",
  heading: "Reset your password",
  paragraphs: ["Someone asked to reset the password for this address."],
  cta: { text: "Choose a new password", url },
  reason: "You're receiving this because someone asked to reset your password.",
})
```

| Import                      | What it gives                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@kaperkunde/mail`          | `createMailer` (SMTP under the app's own env prefix, Mailpit on localhost:1025 by default, timeouts), `renderEmail`, the types |
| `@kaperkunde/mail/template` | `renderEmail` alone, with no nodemailer, for previews                                                                          |
| `@kaperkunde/mail/testing`  | `mailpit(url).clear / count / waitFor`, `firstLink`                                                                            |

A message is text, never markup: paragraphs (with bold runs), one call to
action, an optional second link and footnote, the message's own links (an
unsubscribe), and a required `reason`. The theme holds the brand's name, logo,
colours, fonts, footer links and operator line. The plain-text part lists the
call to action first, which is what `firstLink` reads.
