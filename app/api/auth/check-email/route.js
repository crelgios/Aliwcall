import { NextResponse } from "next/server";
import { resolveMx } from "dns/promises";

export const runtime = "nodejs";

const BLOCKED_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "mailinator.com",
  "mailinator.net",
  "mailinator2.com",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempail.com",
  "throwawaymail.com",
  "throwawaymail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "sharklasers.com",
  "grr.la",
  "guerrillamail.info",
  "guerrillamail.biz",
  "pokemail.net",
  "spam4.me",
  "getnada.com",
  "nada.email",
  "maildrop.cc",
  "dispostable.com",
  "mintemail.com",
  "mohmal.com",
  "mytemp.email",
  "emailondeck.com",
  "fakeinbox.com",
  "trashmail.com",
  "trashmail.me",
  "trashmail.net",
  "trashmail.org",
  "mailnesia.com",
  "mailcatch.com",
  "incognitomail.com",
  "spambog.com",
  "tempinbox.com"
]);

const BLOCKED_PATTERNS = [
  /(^|\.)temp-?mail/i,
  /(^|\.)10minute/i,
  /(^|\.)throwaway/i,
  /(^|\.)disposable/i,
  /(^|\.)trashmail/i,
  /(^|\.)mailinator/i,
  /(^|\.)guerrilla/i
];

function domainOf(email) {
  const value = String(email || "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return null;
  return value.slice(at + 1);
}

export async function POST(request) {
  try {
    const { email } = await request.json();
    const domain = domainOf(email);

    if (!domain) {
      return NextResponse.json(
        { allowed: false, message: "Enter a valid email address." },
        { status: 400 }
      );
    }

    if (
      BLOCKED_DOMAINS.has(domain) ||
      BLOCKED_PATTERNS.some((pattern) => pattern.test(domain))
    ) {
      return NextResponse.json(
        {
          allowed: false,
          message: "Temporary or disposable email addresses are not allowed. Please use a permanent email such as Gmail, Outlook, Yahoo, iCloud, or your business email."
        },
        { status: 400 }
      );
    }

    try {
      const mx = await resolveMx(domain);
      if (!Array.isArray(mx) || mx.length === 0) {
        return NextResponse.json(
          {
            allowed: false,
            message: "This email domain cannot receive mail. Please use a valid permanent email address."
          },
          { status: 400 }
        );
      }
    } catch (error) {
      if (error?.code === "ENOTFOUND" || error?.code === "ENODATA") {
        return NextResponse.json(
          {
            allowed: false,
            message: "This email domain does not appear to be valid. Please use a permanent email address."
          },
          { status: 400 }
        );
      }

      // Fail open for temporary DNS/network errors so genuine users are not blocked.
    }

    return NextResponse.json({ allowed: true });
  } catch {
    return NextResponse.json(
      { allowed: false, message: "Could not validate email right now. Please try again." },
      { status: 500 }
    );
  }
}
