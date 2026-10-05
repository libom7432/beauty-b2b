const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

function validSiteUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export const siteConfig = {
  brandPlaceholder: "Brand",
  siteUrl: validSiteUrl(configuredUrl),
};
