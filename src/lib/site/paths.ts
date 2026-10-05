import type { Locale } from "@/i18n/config";

export function localizedPath(locale: Locale, path = "/") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return locale === "zh" ? `/zh${normalized === "/" ? "" : normalized}` : normalized;
}

export function pathWithoutLocale(pathname: string) {
  return pathname.replace(/^\/zh(?=\/|$)/, "") || "/";
}
