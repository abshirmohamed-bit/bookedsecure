import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

const UPDATED = "10 November 2026";
const CONTACT = "support@bookedsecure.com";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy policy | BookedSecure" },
      {
        name: "description",
        content:
          "How BookedSecure collects, uses, stores and protects personal information, including SMS and email messages and connected Facebook, Instagram and LinkedIn accounts.",
      },
      { property: "og:title", content: "Privacy policy | BookedSecure" },
      { property: "og:description", content: "How BookedSecure handles personal information." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PrivacyPage,
});

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <>
        <p>
          BookedSecure (“we”, “us”) is software that helps Australian service businesses capture enquiries, quote, book
          jobs, follow up with customers, and run email campaigns and social media from one place. This policy explains how
          we handle personal information in line with the Privacy Act 1988 (Cth) and the Australian Privacy Principles.
        </p>
        <p>
          We handle information for two groups: <strong>businesses</strong> that use BookedSecure and their team members,
          and <strong>those businesses’ customers</strong> (people who make an enquiry, get a quote, book a job or receive a
          message). For customer information, the business decides what is collected and why, and we handle it on the
          business’s behalf.
        </p>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <ul>
        <li><strong>Account details:</strong> name, email address, mobile number, password (stored as a secure hash) and role for each business user.</li>
        <li><strong>Business details:</strong> business name, services and prices, service area, opening hours, ABN, website and branding.</li>
        <li><strong>Customer and enquiry details:</strong> names, mobile numbers, email addresses, suburbs, enquiry and quote details, bookings, notes and job history entered by the business, submitted through its quote page, or imported from Facebook Lead Ads.</li>
        <li><strong>Messages:</strong> SMS and email messages sent and received through BookedSecure, with delivery status, replies, opt-outs and unsubscribe records.</li>
        <li><strong>Connected accounts</strong> (only when a business owner chooses to connect them; see below).</li>
        <li><strong>Usage and device information:</strong> log data such as IP address, browser type and pages used, and push notification tokens for devices that allow notifications.</li>
      </ul>
    ),
  },
  {
    id: "connected",
    title: "Facebook, Instagram and LinkedIn connections",
    body: (
      <>
        <p>A business owner can connect their own social accounts. We only request what each feature needs, and the owner can disconnect at any time.</p>
        <ul>
          <li>
            <strong>Facebook and Instagram:</strong> with the owner’s permission we read leads from Facebook Lead Ads, comments and
            direct messages on the connected Page, and ad spend figures, so the business can respond and see results. Replies are
            only posted or sent when the owner approves them.
          </li>
          <li>
            <strong>LinkedIn:</strong> when the owner signs in with LinkedIn we receive their name and LinkedIn member ID, and
            permission to publish posts they create in BookedSecure to their profile (and, where LinkedIn allows it, to Company
            Pages they manage). We keep a record of posts published from BookedSecure. We do not read, send or store LinkedIn
            messages, connections or other members’ data.
          </li>
        </ul>
        <p>
          Access tokens for connected accounts are encrypted and only used by our servers for the connected business. Use of
          information received from Meta and LinkedIn follows their platform terms. Disconnecting removes the stored token.
        </p>
      </>
    ),
  },
  {
    id: "use",
    title: "How we use information",
    body: (
      <ul>
        <li>To provide BookedSecure: storing enquiries and bookings, sending the messages and emails a business sets up, and showing replies.</li>
        <li>To publish social posts and replies the business owner has approved.</li>
        <li>To draft messages, emails and posts with AI when a business asks for it. Drafts are reviewed by the business before anything is sent.</li>
        <li>To send account notices, alerts and support replies to business users.</li>
        <li>To keep the service secure, prevent misuse, and fix problems.</li>
        <li>To measure and improve the service using aggregated information.</li>
      </ul>
    ),
  },
  {
    id: "sms-email",
    title: "SMS and email messages",
    body: (
      <>
        <p>
          Businesses use BookedSecure to send SMS about an enquiry, quote or booking, including short follow-ups. Reply
          <strong> STOP</strong>, UNSUBSCRIBE, CANCEL or QUIT at any time and automated messages stop straight away; the opt-out is
          recorded with a timestamp.
        </p>
        <p>
          Campaign emails are sent in the business’s name and include an unsubscribe link that takes effect immediately.
          Replies to campaign emails come back to the business inside BookedSecure.
        </p>
      </>
    ),
  },
  {
    id: "share",
    title: "Who we share it with",
    body: (
      <>
        <p>We don’t sell personal information. We share it only with service providers that help us run BookedSecure, under contracts that require them to protect it:</p>
        <ul>
          <li>cloud hosting and database providers;</li>
          <li>SMS delivery and email delivery providers;</li>
          <li>push notification services;</li>
          <li>AI model providers, used only to produce drafts and summaries requested by the business;</li>
          <li>Meta and LinkedIn, when a business connects those accounts and asks us to publish or read on its behalf;</li>
          <li>payment processors for business subscriptions.</li>
        </ul>
        <p>
          Some of these providers store or process information outside Australia, including in the United States and other
          countries. We may also disclose information where required by law.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security and retention",
    body: (
      <>
        <p>
          Information is encrypted in transit, access is limited by business and role, and sensitive tokens are stored with
          additional encryption. No system is perfectly secure, and we will notify affected people and the Office of the
          Australian Information Commissioner of an eligible data breach as the law requires.
        </p>
        <p>
          We keep information while a business uses BookedSecure and as needed for legal, billing and security purposes. When a
          business closes its account, its data is deleted or de-identified within a reasonable period unless the law requires us
          to keep it.
        </p>
      </>
    ),
  },
  {
    id: "choices",
    title: "Your choices and rights",
    body: (
      <>
        <p>
          You can ask to access or correct your personal information, or ask for it to be deleted. If you are a customer of a
          business that uses BookedSecure, please contact that business first, since it controls your records; we’ll help them
          respond. Business users can update their details in the app or contact us.
        </p>
        <p>
          Email us at <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We aim to respond within 30 days. If you’re not satisfied with
          our response, you can complain to the Office of the Australian Information Commissioner at{" "}
          <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">oaic.gov.au</a>.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: <p>We use essential cookies and local storage to keep you signed in and remember preferences. We don’t use advertising cookies.</p>,
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: <p>We may update this policy as BookedSecure changes. The date at the top shows the latest version, and we’ll tell business users about significant changes.</p>,
  },
];

function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <header className="brand-wash rounded-2xl border border-border p-5 sm:p-7">
          <Link to="/" className="text-sm font-semibold text-primary">BookedSecure</Link>
          <h1 className="mt-2 page-heading">Privacy policy</h1>
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
