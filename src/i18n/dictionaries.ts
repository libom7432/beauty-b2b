import type { Locale } from "./config";
import en from "./en";
import zh from "./zh";

const dictionaries = { en, zh };

export type Dictionary = typeof en;

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
