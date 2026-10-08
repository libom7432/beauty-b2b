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
  contact: {
    // Preview values only. Replace both fields when the verified contact details are ready.
    whatsapp: {
      display: "+00 000 000 0000",
      international: "00000000000",
      message: "Hello, I'm interested in your nail products and private label services.",
    },
    email: "sales@example.com",
  },
};

export function whatsappUrl() {
  const { international, message } = siteConfig.contact.whatsapp;
  const number = international.replace(/\D/g, "");
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function emailUrl() {
  return `mailto:${siteConfig.contact.email}`;
}
