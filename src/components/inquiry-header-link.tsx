"use client";

import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { localizedPath } from "@/lib/site/paths";
import { useInquiry } from "./inquiry-provider";

export function InquiryHeaderLink({ locale }: { locale: Locale }) {
  const { itemCount, ready } = useInquiry();
  const label = getDictionary(locale).inquiry.title;
  return <Link className="inquiry-header-link" href={localizedPath(locale, "/inquiry")}>{label} ({ready ? itemCount : 0})</Link>;
}
