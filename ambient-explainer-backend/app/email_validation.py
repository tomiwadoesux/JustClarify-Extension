import re

import dns.exception
import dns.resolver

EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

DISPOSABLE_DOMAINS = {
    "10minutemail.com",
    "20minutemail.com",
    "dispostable.com",
    "emailondeck.com",
    "fakeinbox.com",
    "generator.email",
    "getairmail.com",
    "guerrillamail.com",
    "maildrop.cc",
    "mailinator.com",
    "mailnesia.com",
    "mintemail.com",
    "sharklasers.com",
    "tempmail.com",
    "temp-mail.org",
    "throwawaymail.com",
    "trashmail.com",
    "yopmail.com",
}


def normalize_email(email: str) -> str:
    return email.strip().lower()


def has_valid_format(email: str) -> bool:
    return bool(EMAIL_PATTERN.fullmatch(email))


def is_disposable_domain(domain: str) -> bool:
    return domain in DISPOSABLE_DOMAINS


def domain_has_mail_records(domain: str) -> bool:
    resolver = dns.resolver.Resolver()
    resolver.timeout = 2
    resolver.lifetime = 2

    try:
        mx_records = resolver.resolve(domain, "MX")
        if len(mx_records) > 0:
            return True
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
        pass
    except dns.exception.DNSException:
        return False

    for fallback_record_type in ("A", "AAAA"):
        try:
            records = resolver.resolve(domain, fallback_record_type)
            if len(records) > 0:
                return True
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
            continue
        except dns.exception.DNSException:
            return False

    return False


def validate_signup_email(email: str) -> str | None:
    normalized_email = normalize_email(email)
    if not has_valid_format(normalized_email):
        return "Please enter a valid email address."

    domain = normalized_email.split("@", 1)[1]
    if is_disposable_domain(domain):
        return "Please use your real email address."

    if not domain_has_mail_records(domain):
        return "That email domain cannot receive mail."

    return None
