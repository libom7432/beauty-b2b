export const locales = ["en", "zh"] as const;
export const defaultLocale = "en";

export type Locale = (typeof locales)[number];

export function isLocale(value: string): value is Locale {
  return locales.some((locale) => locale === value);
}
