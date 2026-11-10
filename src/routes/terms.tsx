import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

const UPDATED = "11 November 2026";
const CONTACT = "bookedsecure@gmail.com";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of service | BookedSecure" },
      { name: "description", content: "The terms for using BookedSecure, including connected Facebook, Instagram, LinkedIn and YouTube accounts, messaging and payments." },
      { property: "og:title", content: "Terms of service | BookedSecure" },
      { property: "og:description", content: "The terms for using BookedSecure." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TermsPage,
});

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "agreement",
    title: "The agreement",
    body: (
      <>
        <p>
          These terms apply when a business (“you”) signs up for or uses BookedSecure (“we”, “us”), software for capturing
          enquiries, quoting, booking, following up with customers, email campaigns and social media. By creating an account or
          using BookedSecure you agree to these terms and to our <Link to="/privacy">privacy policy</Link>. If you use it for a
          business, you confirm you can accept these terms for that business.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <ul>
        <li>Keep sign-in details secure and tell us about any unauthorised use. You are responsible for what happens under your account, including your team members.</li>
        <li>Give accurate business details, services and prices. Customers see what you publish on your quote page.</li>
        <li>You must be at least 18 and running a genuine business.</li>
      </ul>
    ),
  },
  {
    id: "use",
    title: "Acceptable use",
    body: (
      <>
        <p>You agree not to use BookedSecure to:</p>
        <ul>
          <li>send messages without the consent the Spam Act 2003 (Cth) requires, or to people who have opted out;</li>
          <li>post or send anything unlawful, misleading, defamatory, or that infringes someone else’s rights;</li>
          <li>upload content you don’t have the right to publish, including videos, music and images;</li>
          <li>break the terms of a connected platform, or try to get around BookedSecure’s security, limits or approvals.</li>
        </ul>
        <p>We may suspend accounts that put customers, other businesses or the service at risk.</p>
      </>
    ),
  },
  {
    id: "connected",
    title: "Connected accounts",
    body: (
      <>
        <p>
          You can connect your own Facebook, Instagram, LinkedIn and YouTube accounts. BookedSecure only posts, uploads, replies
          or sends when you (or someone you allow) approve it. You remain responsible for what is published and must follow each
          platform’s rules, including the{" "}
          <a href="https://www.facebook.com/terms" target="_blank" rel="noreferrer">Meta Terms</a>,{" "}
          <a href="https://www.linkedin.com/legal/user-agreement" target="_blank" rel="noreferrer">LinkedIn User Agreement</a> and{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>.
        </p>
        <p>
          BookedSecure uses YouTube API Services. By connecting YouTube you agree to the YouTube Terms of Service, and Google’s
          handling of data is covered by the{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>. You can
          disconnect any account in BookedSecure at any time, or remove access from the platform’s own settings.
        </p>
      </>
    ),
  },
  {
    id: "content",
    title: "Your data and content",
    body: (
      <>
        <p>
          You own your business data and content, including customer records, messages, posts and videos. You give us
          permission to store, process and send it only to provide BookedSecure to you. Our handling of personal information is
          described in the <Link to="/privacy">privacy policy</Link>.
        </p>
        <p>
          AI features draft suggestions, such as replies, posts, titles and campaign emails. Check them before you approve them;
          you are responsible for what you send or publish.
        </p>
      </>
    ),
  },
  {
    id: "billing",
    title: "Plans, trials and payment",
    body: (
      <ul>
        <li>New accounts start with a free trial. After it ends, a paid plan is needed to keep using paid features.</li>
        <li>Subscriptions renew automatically until cancelled. You can cancel at any time and keep access until the end of the paid period.</li>
        <li>Usage-based items, such as SMS credits, are charged as shown in the app. Fees are in Australian dollars and include GST where it applies.</li>
        <li>Nothing in these terms limits your rights under the Australian Consumer Law.</li>
      </ul>
    ),
  },
  {
    id: "service",
    title: "The service",
    body: (
      <>
        <p>
          We work to keep BookedSecure available and secure, but it relies on other providers (hosting, SMS, email, payment and
          social platforms) and may sometimes be unavailable. We may change or improve features, and will tell you about changes
          that significantly affect you.
        </p>
        <p>
          To the extent the law allows, we aren’t liable for indirect or consequential loss, or for loss caused by connected
          platforms, and our total liability is limited to the fees you paid us in the 12 months before the claim.
        </p>
      </>
    ),
  },
  {
    id: "ending",
    title: "Ending your account",
    body: (
      <p>
        You can stop using BookedSecure and close your account at any time. We may end or suspend access if these terms are
        seriously broken. After closure, your data is deleted or de-identified within a reasonable period, as described in the
        privacy policy.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law and changes",
    body: (
      <p>
        These terms are governed by the laws of New South Wales, Australia. We may update them as BookedSecure changes. The date
        at the top shows the latest version, and we’ll tell business users about significant changes.
      </p>
    ),
  },
];

function TermsPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <header className="brand-wash rounded-2xl border border-border p-5 sm:p-7">
          <Link to="/" className="text-sm font-semibold text-primary">BookedSecure</Link>
          <h1 className="mt-2 page-heading">Terms of service</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated {UPDATED}</p>
          <nav aria-label="On this page" className="mt-4 flex flex-wrap gap-1.5">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-full border border-white/70 bg-white/60 px-2.5 py-1 text-xs text-muted-foreground hover:text-primary">
                {s.title}
              </a>
            ))}
          </nav>
        </header>
        <div className="panel mt-4 space-y-8 p-5 text-sm leading-relaxed text-muted-foreground sm:p-8 [&_a]:font-medium [&_a]:text-primary [&_a:hover]:underline [&_li]:mt-1.5 [&_p+p]:mt-3 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-6">
              <h2 className="mb-2 text-base font-semibold text-foreground">{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Questions? <a className="text-primary hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </div>
    </main>
  );
}
