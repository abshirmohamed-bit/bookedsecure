import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  Check,
  ClipboardList,
  Inbox,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Phone,
  Repeat2,
  Sparkles,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import brandMark from "@/assets/bookedsecure-mark.png.asset.json";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const PHONE = "+61 466 907 824";
const PHONE_HREF = "tel:+61466907824";
/** Demo requests go to hello@bookedsecure.com, which reaches the team inbox. */
const DEMO_HREF = "mailto:hello@bookedsecure.com?subject=Book%20a%20BookedSecure%20demo&body=Hi%2C%20I%27d%20like%20a%20demo%20of%20BookedSecure.%0A%0ABusiness%20name%3A%0AWhat%20we%20do%3A%0ABest%20time%20to%20call%3A";

const STEPS = [
  {
    icon: ClipboardList,
    title: "Capture every enquiry",
    body: "Your quote page, Facebook and Instagram, imports and manual entry all land in one Leads inbox.",
  },
  {
    icon: MessageSquare,
    title: "Reply instantly and follow up",
    body: "Each enquiry gets an immediate acknowledgement and scheduled follow-ups, so nothing is forgotten.",
  },
  {
    icon: Repeat2,
    title: "Keep the conversation moving",
    body: "Customer replies are tracked with the lead, so you always know where every conversation stands.",
  },
  {
    icon: CalendarDays,
    title: "Confirm the next step",
    body: "You stay in control. Review the lead, answer questions and move it to a quote or a booking.",
  },
];

const AUDIENCE = [
  "Mobile service businesses",
  "Cleaning, lawn and garden",
  "Trades and sole traders",
  "Automotive detailing",
  "Owner-operators and small teams",
  "Anyone who books jobs from enquiries",
];

/** Glass surface used throughout, matching the dashboard. */
function Glass({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("glass", className)}>{children}</div>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/55 px-3 py-1 text-xs font-medium text-primary shadow-[inset_0_1px_0_white] backdrop-blur-xl">
      <span className="size-1.5 rounded-full bg-primary" />
      {children}
    </p>
  );
}

function PrimaryCta({ signedIn, className }: { signedIn: boolean; className?: string }) {
  return (
    <Button asChild size="lg" className={cn("h-12 rounded-xl px-6 text-[15px]", className)}>
      {signedIn ? (
        <Link to="/dashboard">
          Go to your dashboard <ArrowRight />
        </Link>
      ) : (
        <a href={PHONE_HREF}>
          <Phone /> Call {PHONE}
        </a>
      )}
    </Button>
  );
}

/* ---------- Product preview, built from the real dashboard's parts ---------- */

const MOCK_NAV: { label: string; icon: typeof Inbox; badge?: number; active?: boolean; group?: string }[] = [
  { label: "Home", icon: Sparkles, active: true },
  { label: "Assistant", icon: Bot },
  { label: "Leads", icon: Inbox, badge: 2, group: "Inbox" },
  { label: "Facebook and Instagram", icon: MessagesSquare, badge: 4 },
  { label: "Bookings", icon: CalendarDays, group: "Work" },
  { label: "Campaigns", icon: Megaphone },
  { label: "Results", icon: BarChart3 },
];

function ProductPreview() {
  return (
    <div className="relative">
      <div className="overflow-hidden rounded-[22px] border border-white/70 bg-white/45 shadow-[inset_0_1px_0_white,0_40px_90px_-30px_oklch(0.25_0.11_258/0.55)] backdrop-blur-2xl">
        {/* window bar */}
        <div className="flex items-center gap-1.5 border-b border-white/60 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="ml-3 hidden rounded-md bg-white/60 px-2.5 py-0.5 text-[11px] text-muted-foreground sm:inline">bookedsecure.com/dashboard</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[13rem_minmax(0,1fr)]">
          {/* sidebar */}
          <aside className="hidden border-r border-white/60 bg-white/35 p-3 md:block" aria-hidden>
            <div className="mb-3 flex items-center gap-2 px-1">
              <img src={brandMark.url} alt="" className="size-7 object-contain" />
              <div>
                <p className="text-xs font-semibold">Your business</p>
                <p className="text-[10px] text-muted-foreground">Your workspace</p>
              </div>
            </div>
            {MOCK_NAV.map((item) => (
              <div key={item.label}>
                {item.group && <p className="mt-3 px-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{item.group}</p>}
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px]",
                    item.active ? "bg-white/85 font-medium text-primary shadow-[inset_0_1px_0_white,0_2px_8px_-4px_oklch(0.3_0.1_258/0.3)]" : "text-muted-foreground",
                  )}
                >
                  <item.icon className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">{item.badge}</span> : null}
                </div>
              </div>
            ))}
          </aside>

          {/* home */}
          <div className="space-y-3 p-3 sm:p-4" aria-hidden>
            <div>
              <p className="text-sm font-semibold tracking-[-0.01em]">Good morning</p>
              <p className="text-[11px] text-muted-foreground">Here's what needs you today.</p>
            </div>
            <div className="rounded-2xl border border-primary/25 bg-white/85 p-3 shadow-[0_10px_24px_-14px_color-mix(in_oklab,var(--primary)_70%,transparent)]">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary)] text-white">
                  <UserPlus className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">2 leads are waiting for your reply</p>
                  <p className="truncate text-[10px] text-muted-foreground">Jess M. · Full detail · Parramatta</p>
                </div>
                <span className="rounded-lg bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground">Reply</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["New leads", "14", "This week"],
                ["Booked", "6", "This week"],
                ["Replied", "9", "Customers"],
              ].map(([label, value, hint]) => (
                <div key={label} className="rounded-xl border border-white/70 bg-white/60 p-2.5">
                  <p className="text-[9px] font-medium text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold tracking-[-0.02em]">{value}</p>
                  <p className="text-[9px] text-muted-foreground">{hint}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-white/70 bg-white/55 p-2.5">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Latest leads</p>
              {[
                ["JM", "Jess M.", "Quote request · Full detail", "2 min"],
                ["DK", "Daniel K.", "Facebook lead · Interior clean", "18 min"],
                ["AR", "Aisha R.", "Instagram DM · Ceramic coating", "1 h"],
              ].map(([initials, name, detail, when]) => (
                <div key={name} className="flex items-center gap-2 py-1">
                  <span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary-deep)] text-[9px] font-semibold text-white">{initials}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium">{name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{detail}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{when}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* floating glass cards */}
      <div className="animate-float absolute -left-4 top-24 hidden w-60 rounded-2xl border border-white/80 bg-white/80 p-3 shadow-[inset_0_1px_0_white,0_20px_40px_-18px_oklch(0.25_0.1_258/0.5)] backdrop-blur-2xl lg:-left-12 lg:block" aria-hidden>
        <div className="flex items-start gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary)] text-white">
            <Bell className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold">Quote request: Jess</p>
            <p className="text-[10px] text-muted-foreground">Full detail · Parramatta. Tap to reply.</p>
            <p className="mt-0.5 text-[9px] text-muted-foreground">now</p>
          </div>
        </div>
      </div>
      <div className="animate-float-slow absolute -bottom-6 -right-3 hidden w-64 rounded-2xl border border-white/80 bg-white/80 p-3 shadow-[inset_0_1px_0_white,0_20px_40px_-18px_oklch(0.25_0.1_258/0.5)] backdrop-blur-2xl sm:block lg:-right-10" aria-hidden>
        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-primary">
          <Bot className="size-3.5" /> Assistant
        </p>
        <p className="rounded-xl rounded-tr-sm bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground">Book Jess in for Saturday 9am</p>
        <p className="mt-1.5 rounded-xl rounded-tl-sm bg-white/90 px-2.5 py-1.5 text-[11px]">Done. Jess is booked for a Full detail on Sat at 9:00 am.</p>
      </div>
    </div>
  );
}

/* ---------- Feature cards ---------- */

function FeatureCard({
  icon: Icon,
  title,
  body,
  className,
  children,
}: {
  icon: typeof Inbox;
  title: string;
  body: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Glass className={cn("flex flex-col p-5 transition-transform duration-300 hover:-translate-y-0.5 sm:p-6", className)}>
      <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary)] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_8px_18px_-8px_var(--primary)]">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
      {children && <div className="mt-4 flex-1">{children}</div>}
    </Glass>
  );
}

function SourceChips() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {[
        ["Quote page", Sparkles],
        ["Facebook Lead Ads", Zap],
        ["Instagram and Facebook", MessageCircle],
        ["CSV import", ClipboardList],
        ["Added by hand", UserPlus],
      ].map(([label, Icon]) => {
        const I = Icon as typeof Inbox;
        return (
          <span key={label as string} className="inline-flex items-center gap-1 rounded-full border border-white/80 bg-white/65 px-2.5 py-1 text-xs">
            <I className="size-3 text-primary" />
            {label as string}
          </span>
        );
      })}
    </div>
  );
}

function FollowUpTimeline() {
  return (
    <ol className="space-y-2 text-xs">
      {[
        ["Instantly", "Thanks for your enquiry, here's what happens next"],
        ["Next day", "Friendly follow-up if they haven't replied"],
        ["A few days later", "Last check-in, then it stops"],
      ].map(([when, what], i) => (
        <li key={when} className="flex items-start gap-2.5">
          <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold", i === 0 ? "bg-primary text-primary-foreground" : "bg-white/80 text-primary")}>{i + 1}</span>
          <span>
            <span className="font-medium">{when}</span>
            <span className="text-muted-foreground"> · {what}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function AssistantChat() {
  return (
    <div className="space-y-1.5 text-xs">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-1.5 text-primary-foreground">Who's waiting for my reply?</p>
      <p className="w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-white/85 px-3 py-1.5">Jess and Daniel. Jess wants a full detail in Parramatta; Daniel asked about an interior clean.</p>
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-1.5 text-primary-foreground">Text them both that I can do Saturday.</p>
      <p className="w-fit max-w-[90%] rounded-2xl rounded-tl-sm bg-white/85 px-3 py-1.5">Both texts are ready below for you to confirm.</p>
    </div>
  );
}

/* ---------- Page ---------- */

export function HomeLanding() {
  const { session } = useAuth();
  const signedIn = Boolean(session);

  return (
    <div className="min-h-screen text-foreground">
      {/* Floating glass header */}
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 rounded-2xl border border-white/70 bg-white/55 px-3 shadow-[inset_0_1px_0_white,0_10px_30px_-18px_oklch(0.25_0.1_258/0.45)] backdrop-blur-2xl backdrop-saturate-150 sm:px-4">
          <a href="#top" className="flex min-w-0 items-center gap-2" aria-label="BookedSecure home">
            <img src={brandMark.url} alt="" className="size-8 shrink-0 object-contain" />
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">BookedSecure</span>
          </a>
          <nav className="ml-6 hidden items-center gap-1 text-sm text-muted-foreground md:flex" aria-label="Sections">
            <a href="#features" className="rounded-lg px-3 py-1.5 hover:bg-white/70 hover:text-foreground">Features</a>
            <a href="#how-it-works" className="rounded-lg px-3 py-1.5 hover:bg-white/70 hover:text-foreground">How it works</a>
            <a href="#who" className="rounded-lg px-3 py-1.5 hover:bg-white/70 hover:text-foreground">Who it's for</a>
            <Link to="/pricing" className="rounded-lg px-3 py-1.5 hover:bg-white/70 hover:text-foreground">Pricing</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {!signedIn && (
              <Button asChild variant="outline" size="sm" className="hidden rounded-xl px-4 sm:inline-flex">
                <a href={DEMO_HREF}><CalendarDays /> Book a demo</a>
              </Button>
            )}
            <Button asChild size="sm" className="rounded-xl px-4">
              <Link to={signedIn ? "/dashboard" : "/auth"}>{signedIn ? "Dashboard" : "Sign in"}</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:pb-24">
          <div className="mx-auto max-w-3xl text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Eyebrow>For Australian service businesses</Eyebrow>
            <h1 className="mt-6 text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-7xl lg:text-[84px]">
              It's really{" "}
              <span className="bg-gradient-to-r from-[var(--primary-deep)] via-[var(--primary)] to-[var(--primary-bright)] bg-clip-text text-transparent">simple.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
              Capture new leads. Re-engage the ones you already paid for. Turn more enquiries into bookings.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <PrimaryCta signedIn={signedIn} className="w-full sm:w-auto" />
              <Button asChild size="lg" variant="outline" className="h-12 w-full rounded-xl px-6 text-[15px] sm:w-auto">
                <a href="#how-it-works">See how it works</a>
              </Button>
            </div>
            <ul className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {["Capture new leads", "Follow up consistently", "Turn enquiries into bookings"].map((label) => (
                <li key={label} className="flex items-center gap-1.5">
                  <span className="grid size-4 place-items-center rounded-full bg-primary/15 text-primary">
                    <Check className="size-3" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <div className="mx-auto mt-14 max-w-5xl animate-in fade-in slide-in-from-bottom-8 duration-1000 sm:mt-16">
            <ProductPreview />
            <p className="mt-10 text-center text-xs text-muted-foreground">Example workspace. Names and numbers are illustrative.</p>
          </div>
        </section>

        {/* Problem */}
        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <Glass className="grid gap-6 p-6 sm:p-10 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-12">
            <div>
              <p className="text-sm font-semibold text-primary">What BookedSecure does</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.025em] sm:text-[40px]">
                Every enquiry you don't answer is a job that goes to someone else.
              </h2>
            </div>
            <p className="text-lg leading-8 text-muted-foreground">
              BookedSecure captures, acknowledges and follows up automatically, so you spend less time chasing and more time working.
            </p>
          </Glass>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-primary">Everything in one place</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] sm:text-[40px]">Your leads, replies and bookings, working together.</h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-6">
            <FeatureCard className="md:col-span-3" icon={Inbox} title="Every enquiry in one inbox" body="Leads from your quote page, Facebook Lead Ads, Instagram and Facebook, imports and manual entry, all in one list with their full history.">
              <SourceChips />
            </FeatureCard>
            <FeatureCard className="md:col-span-3" icon={Zap} title="Instant reply, then follow-ups" body="Each new lead gets a text straight away and a follow-up sequence that stops when they reply or opt out. Quiet hours respected.">
              <FollowUpTimeline />
            </FeatureCard>
            <FeatureCard className="md:col-span-2" icon={Sparkles} title="An AI quote page" body="Your own quote page chats with customers, works out what they need from your services and prices, and hands you a ready lead." />
            <FeatureCard className="md:col-span-2" icon={Bell} title="New leads first" body="Push alerts tell you who wants what, and your notifications always put new leads at the top." />
            <FeatureCard className="md:col-span-2" icon={MessagesSquare} title="Comments and DMs" body="Facebook and Instagram comments and messages arrive with a suggested reply. Nothing is posted until you approve it." />
            <FeatureCard className="md:col-span-4" icon={Bot} title="An assistant that does the work" body="Ask in plain English and it books jobs, updates leads, drafts campaigns and tells you who's waiting. Texts always wait for your confirm.">
              <AssistantChat />
            </FeatureCard>
            <div className="grid gap-4 md:col-span-2">
              <FeatureCard icon={Mail} title="Text and email campaigns" body="Win back past customers with an automatic follow-up for anyone who doesn't book." />
              <FeatureCard icon={BarChart3} title="Results you can trust" body="Cost per lead and per booking from your Facebook ads, booking rates and revenue from completed jobs." />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-primary">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] sm:text-[40px]">From enquiry to next step.</h2>
          </div>
          <ol className="relative mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <span className="absolute left-6 right-6 top-[2.6rem] hidden h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent lg:block" aria-hidden />
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <Glass className="relative h-full p-5 sm:p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-full bg-white/90 text-sm font-semibold text-primary shadow-[inset_0_1px_0_white,0_6px_16px_-8px_var(--primary)]">0{i + 1}</span>
                    <step.icon className="size-5 text-primary/70" />
                  </div>
                  <h3 className="mt-6 text-[17px] font-semibold tracking-[-0.01em]">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
                </Glass>
              </li>
            ))}
          </ol>
        </section>

        {/* Who it's for */}
        <section id="who" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24">
          <Glass className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_1.3fr] lg:gap-12">
            <div>
              <p className="text-sm font-semibold text-primary">Who it's for</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] sm:text-[40px]">Built for service businesses.</h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                Australian businesses that get enquiries from websites, social media, Google, quote forms, phone calls and referrals.
              </p>
            </div>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {AUDIENCE.map((item) => (
                <li key={item} className="flex items-center gap-3 rounded-xl border border-white/80 bg-white/60 px-4 py-3.5 text-sm font-medium shadow-[inset_0_1px_0_white]">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                    <Users className="size-3.5" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Glass>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6 sm:pb-24">
          <div className="relative overflow-hidden rounded-[28px] border border-white/30 bg-gradient-to-br from-[var(--primary-deep)] via-[var(--primary)] to-[var(--primary-bright)] p-8 text-white shadow-[0_40px_80px_-30px_var(--primary)] sm:p-14">
            <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-white/15 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-28 left-10 size-72 rounded-full bg-[oklch(0.8_0.12_200/0.35)] blur-3xl" aria-hidden />
            <div className="relative flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
              <div className="max-w-xl">
                <h2 className="text-3xl font-semibold tracking-[-0.025em] sm:text-[44px] sm:leading-[1.08]">Turn more enquiries into bookings.</h2>
                <p className="mt-3 text-white/80">Talk to us about setting up BookedSecure for your business.</p>
              </div>
              <Button asChild size="lg" className="h-12 shrink-0 rounded-xl border border-white/60 bg-white !bg-none px-6 text-[15px] text-[var(--primary-deep)] hover:bg-white/90">
                {signedIn ? (
                  <Link to="/dashboard">Go to your dashboard <ArrowRight /></Link>
                ) : (
                  <a href={PHONE_HREF}><Phone /> Call {PHONE}</a>
                )}
              </Button>
            </div>
          </div>
        </section>

        <footer className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
          <Glass className="p-6 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-foreground">
                <img src={brandMark.url} alt="" className="size-7 object-contain" />
                <span className="text-sm font-semibold">BookedSecure</span>
              </div>
              <nav className="flex flex-wrap items-center gap-4" aria-label="Footer">
                <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
                <Link to="/privacy" className="hover:text-foreground">Privacy policy</Link>
                <Link to={signedIn ? "/dashboard" : "/auth"} className="hover:text-foreground">{signedIn ? "Dashboard" : "Sign in"}</Link>
              </nav>
            </div>
            <p className="mt-5 max-w-4xl border-t border-white/60 pt-5 leading-5">
              BookedSecure does not guarantee message delivery, customer responses, bookings, revenue outcomes or legal compliance for a particular
              business. Businesses remain responsible for obtaining appropriate customer consent and using communications in accordance with
              applicable requirements.
            </p>
          </Glass>
        </footer>
      </main>
    </div>
  );
}
