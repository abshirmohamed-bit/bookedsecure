# Connecting ChatGPT or Claude to BookedSecure

ChatGPT and Claude use the same secure BookedSecure connection (OAuth MCP):

**Connection address:** `https://bookedsecure.com/mcp`

The owner signs in with their BookedSecure login when the assistant asks, and the
assistant then works only in that owner's business. Changes are owner only and
recorded in the audit log.

## Claude (claude.ai, desktop and mobile apps)

1. In Claude, open **Settings → Connectors** (on some plans: **Customize → Connectors**).
2. Choose **Add custom connector**.
3. Name it **BookedSecure** and paste `https://bookedsecure.com/mcp`.
4. Press **Add**, then **Connect**, and sign in with the BookedSecure owner login.
5. In a chat, turn BookedSecure on from the tools/connectors menu.

Custom connectors need a Claude plan that supports them. On team plans an admin may
have to add the connector for the organisation first.

## ChatGPT

1. In ChatGPT, open **Settings → Apps & Connectors** (Developer mode may need to be on).
2. Choose **Create** / **Add custom connector**, name it **BookedSecure** and paste
   `https://bookedsecure.com/mcp`, with OAuth authentication.
3. Sign in with the BookedSecure owner login.
4. After BookedSecure adds new tools, refresh the connector (or start a new chat) so
   ChatGPT sees them.

## Email campaigns from an assistant

Everything on the Campaigns page can be done by asking, for example:

- "How many past customers can I email?"
- "Write an email to past customers about 15% off interior details this month, keep it short."
- "Save that as a campaign for past customers, with a follow-up after 3 days if they haven't booked."
- "Take Jess off that campaign and add Daniel."
- "Change the subject to 'Spring special inside'."
- "Send it." The assistant first shows exactly what will go out (subject, how many
  customers, the first names) and asks you to confirm. It sends only after you say yes.
- "Schedule it for Saturday at 8am instead."
- "How did my last email campaign do?" / "Stop the follow-ups."
- "Any replies to my campaign?" / "What did Jess say?"
- "Reply to Jess: Saturday 9am works, see you then." The assistant shows the exact answer
  first and sends it only after you say yes. Her next reply comes back to Campaigns > Replies.

Emails go out under the business name from `campaigns@bookedsecure.com`, with replies
to the business. Unsubscribed customers are always skipped.

## What the assistant knows about your business

After you set up from your website, BookedSecure keeps a business profile: your industry, whether you book jobs or sell plans, a short about, who you serve, key features, trial and terms, and the FAQs on your site. ChatGPT, Claude and the in-app Assistant read it (tool `business_profile`), so you can ask things like:

- "What does my business offer, and what are my plans?"
- "Write a campaign email about our 14-day free trial."
- "Draft a LinkedIn post about our GPS patrol tracking."

Refresh the BookedSecure connector in ChatGPT or Claude after an update so the new tool appears.
