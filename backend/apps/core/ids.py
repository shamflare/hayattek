"""Identifier helpers.

UUIDv7 gives time-ordered primary keys (better B-tree locality than v4) while
remaining non-sequential and unguessable in the public API.
"""

import os
import secrets
import time
import uuid


def uuid7() -> uuid.UUID:
    unix_ms = time.time_ns() // 1_000_000
    rand = int.from_bytes(os.urandom(10), "big")
    value = (unix_ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76  # version
    value |= ((rand >> 62) & 0xFFF) << 64  # rand_a (12 bits)
    value |= 0b10 << 62  # RFC 4122 variant
    value |= rand & ((1 << 62) - 1)  # rand_b
    return uuid.UUID(int=value)


def luhn_check_digit(digits: str) -> str:
    total = 0
    for index, char in enumerate(reversed(digits)):
        n = int(char)
        if index % 2 == 0:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return str((10 - total % 10) % 10)


def luhn_is_valid(number: str) -> bool:
    return number.isdigit() and len(number) > 1 and luhn_check_digit(number[:-1]) == number[-1]


def random_digits(length: int) -> str:
    # First digit non-zero so the number never loses a digit in numeric fields.
    return str(secrets.randbelow(9) + 1) + "".join(
        str(secrets.randbelow(10)) for _ in range(length - 1)
    )


def random_token(nbytes: int = 16) -> str:
    return secrets.token_urlsafe(nbytes)


SAFE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # no 0/O/1/I


def random_code(length: int = 8) -> str:
    return "".join(secrets.choice(SAFE_CODE_ALPHABET) for _ in range(length))
