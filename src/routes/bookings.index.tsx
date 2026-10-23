import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { BookingsCalendar } from "@/components/BookingsCalendar";

export const Route = createFileRoute("/bookings/")({
  head: () => ({
    meta: [
      { title: "Bookings calendar | BookedSecure" },
      {
        name: "description",
        content:
          "See every upcoming detailing job on a calendar, and open any booking for the customer, service and time.",
      },
      { property: "og:title", content: "Bookings calendar | BookedSecure" },
      {
        property: "og:description",
        content: "Upcoming jobs, confirmed times and job details in one calendar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BookingsPage,
});

function BookingsPage() {
  return (
    <AppShell title="Bookings">
      <BookingsCalendar />
    </AppShell>
  );
}
