import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { BusinessSettingsForm, ProviderStatus, type Business } from "@/components/settings/sections";
import { SmsSetupPanel } from "@/components/SmsSetupPanel";
import { AccountHistoryPanel } from "@/components/messaging/AccountHistoryPanel";

/**
 * Everything an owner rarely needs, tucked behind one row on the Messaging
 * page: sending status and provider, the technical number details, safety
 * caps, AI spend, past top-ups and the cancellation request.
 */
export function MessagingAdvanced({
  provider,
  business,
  readOnly,
}: {
  provider: { name: string; ok?: boolean; detail?: string } & Record<string, unknown>;
  business: Business;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border px-4 py-3 text-sm font-medium">
        <span>Advanced &amp; account</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        <AccountHistoryPanel />
        <ProviderStatus provider={provider} />
        <BusinessSettingsForm
          business={business}
          readOnly={readOnly}
          title="Technical sending settings"
          showProvider
          note="Managed by BookedSecure. Only change this if support has asked you to."
        />
        <SmsSetupPanel />
      </CollapsibleContent>
    </Collapsible>
  );
}
