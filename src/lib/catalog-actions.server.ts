/**
 * Service-catalogue orchestration for the owner assistant.
 *
 * Every read and write is scoped by `business_id`, and linking is only ever
 * applied after the owner confirms the proposal on screen. Nothing here creates
 * a service, prices anything, or messages a customer.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  describeAddonLinkChange,
  findNameMatches,
  pickAddon,
  renderCatalogList,
  type AddonLinkRequest,
} from "@/lib/catalog-actions";

export type CatalogView = {
  services: Array<{ id: string; name: string }>;
  addons: Array<{ id: string; name: string; serviceIds: string[] }>;
};

export type AddonLinkProposal = {
  kind: "addon_links";
  addonId: string;
  addonName: string;
  serviceIds: string[];
  serviceNames: string[];
  remove: boolean;
  summary: string;
};

/** The caller's own approved services and add-ons, with current links. */
export async function loadCatalog(businessId: string): Promise<CatalogView> {
  const [{ data: services }, { data: addons }] = await Promise.all([
    supabaseAdmin
      .from("services")
      .select("id, name")
      .eq("business_id", businessId)
      .order("name", { ascending: true }),
    supabaseAdmin
      .from("service_addons")
      .select("id, name, service_addon_links(service_id)")
      .eq("business_id", businessId)
      .order("name", { ascending: true }),
  ]);

  return {
    services: (services ?? []).map((service) => ({ id: service.id, name: service.name })),
    addons: (addons ?? []).map((addon) => ({
      id: addon.id,
      name: addon.name,
      serviceIds: (
        (addon as { service_addon_links?: { service_id: string }[] }).service_addon_links ?? []
      ).map((link) => link.service_id),
    })),
  };
}

export async function answerCatalogList(businessId: string): Promise<string> {
  const catalog = await loadCatalog(businessId);
  return renderCatalogList(catalog);
}

/**
 * Works out which add-on and which of the tenant's own services the owner
 * meant. Returns a message instead of a proposal when the names are unclear, so
 * nothing is guessed.
 */
export async function proposeAddonLinks(input: {
  businessId: string;
  request: AddonLinkRequest;
}): Promise<{ proposal: AddonLinkProposal | null; message: string }> {
  const catalog = await loadCatalog(input.businessId);
  if (catalog.addons.length === 0) {
    return { proposal: null, message: "You have no add-ons yet, so there is nothing to link." };
  }
  if (catalog.services.length === 0) {
    return {
      proposal: null,
      message: "You have no approved services yet, so an add-on cannot be linked.",
    };
  }

  const addon = pickAddon(input.request.text, catalog.addons);
  if (!addon) {
    return {
      proposal: null,
      message: `I could not tell which add-on you meant. Your add-ons are: ${catalog.addons
        .map((row) => row.name)
        .join(", ")}.`,
    };
  }

  // Only the tenant's own services can ever be selected.
  const named = findNameMatches(input.request.text, catalog.services).filter(
    (service) => service.name !== addon.name,
  );
  const targets = input.request.allServices ? catalog.services : named;
  if (targets.length === 0) {
    return {
      proposal: null,
      message: `I could not tell which services to use for "${addon.name}". Name them, or say "all services". Your services are: ${catalog.services
        .map((row) => row.name)
        .join(", ")}.`,
    };
  }

  const current = new Set(addon.serviceIds);
  const changing = input.request.remove
    ? targets.filter((service) => current.has(service.id))
    : targets.filter((service) => !current.has(service.id));
  if (changing.length === 0) {
    return {
      proposal: null,
      message: input.request.remove
        ? `"${addon.name}" is not offered with those services already.`
        : `"${addon.name}" is already available with those services.`,
    };
  }

  const summary = describeAddonLinkChange({
    addonName: addon.name,
    serviceNames: changing.map((service) => service.name),
    remove: input.request.remove,
    allServices: input.request.allServices && changing.length === catalog.services.length,
  });

  return {
    proposal: {
      kind: "addon_links",
      addonId: addon.id,
      addonName: addon.name,
      serviceIds: changing.map((service) => service.id),
      serviceNames: changing.map((service) => service.name),
      remove: input.request.remove,
      summary,
    },
    message: summary,
  };
}

/** Applies a confirmed linking change. Tenant-scoped on every statement. */
export async function applyAddonLinks(input: {
  businessId: string;
  userId: string;
  addonId: string;
  serviceIds: string[];
  remove: boolean;
}): Promise<{ changed: number }> {
  const { data: addon } = await supabaseAdmin
    .from("service_addons")
    .select("id, name")
    .eq("id", input.addonId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (!addon) throw new Error("Add-on not found for this business.");

  const { data: owned } = await supabaseAdmin
    .from("services")
    .select("id")
    .eq("business_id", input.businessId)
    .in("id", input.serviceIds);
  const serviceIds = (owned ?? []).map((service) => service.id);
  if (serviceIds.length === 0) throw new Error("None of those services belong to this business.");

  if (input.remove) {
    const { error } = await supabaseAdmin
      .from("service_addon_links")
      .delete()
      .eq("business_id", input.businessId)
      .eq("addon_id", input.addonId)
      .in("service_id", serviceIds);
    if (error) throw new Error(error.message);
  } else {
    const { data: existing } = await supabaseAdmin
      .from("service_addon_links")
      .select("service_id")
      .eq("business_id", input.businessId)
      .eq("addon_id", input.addonId);
    const already = new Set((existing ?? []).map((row) => row.service_id));
    const rows = serviceIds
      .filter((serviceId) => !already.has(serviceId))
      .map((serviceId) => ({
        business_id: input.businessId,
        addon_id: input.addonId,
        service_id: serviceId,
      }));
    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("service_addon_links").insert(rows);
      if (error) throw new Error(error.message);
    }
  }

  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.userId,
    event_type: input.remove ? "service_addon_unlinked" : "service_addon_linked",
    entity_type: "service_addon",
    entity_id: input.addonId,
    metadata: { addon: addon.name, services: serviceIds.length } as never,
  });

  return { changed: serviceIds.length };
}
