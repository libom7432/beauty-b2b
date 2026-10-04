import type { Locale } from "./config";
import en from "./en";
import zh from "./zh";

const dictionaries = { en, zh };

export function getDictionary(locale: Locale) {
  return dictionaries[locale];
}
