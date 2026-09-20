/**
 * Self-serve number and credit purchase at the messaging provider.
 *
 * Client-safe: holds no secrets. Tenants buy their own dedicated Australian
 * number (and, if they prefer, their own credits) directly at the provider
 * using our referral link, so they arrive as a sub-account we can manage over
 * the API and no card of ours is ever charged for a tenant.
 */

/** Referral sign-up link. anyone signing up here becomes our sub-account. */
export const PROVIDER_SIGNUP_URL = "https://app.texto.com.au/signup?r=bookedsecure";

/** Where an existing sub-account signs in to buy a number or top up credits. */
export const PROVIDER_LOGIN_URL = "https://app.texto.com.au/login";

/** What the provider charges per number, per month, in cents (excluding GST). */
export const NUMBER_MONTHLY_COST_CENTS = 1500;
