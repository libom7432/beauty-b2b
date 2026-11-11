#!/usr/bin/env python3
"""Verify the four CLI deployment candidates against the original migrations."""

from hashlib import sha256
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "supabase" / "migrations"
CANDIDATE = ROOT / "deploy" / "supabase-integration" / "migrations"
EXPECTED = {
    "20261010112952_create_rfq_schema.sql": (
        "59e30dc9e84363b856e80e4c44e1a5858aaae152ad33e77f6220dc3f3443d0e3",
        "76878700c1f9bd26aae8979e03e31adaa49c94111a83c1cd068a3ff810e1c14b",
    ),
    "20261011120000_grant_rfq_api_role.sql": (
        "6d9e07d0db5c83d905ba1e84e6814772ad7d60ea4be8866bfae451a669498cc3",
        "2c2ad2ef3095f6f05a2ea51477089ea4d9456cff02b476ca397eaf43401b55a6",
    ),
    "20261013120000_create_catalog_foundation.sql": (
        "b16b0b977c816a1971fd4f343db80a6ea4aca5c2fac7bdd32301b220842e02c0",
        "5a6b068f5bf482040da996d8d4727e31ae4fbd43cf7e316d18ee6bb42fbe46ec",
    ),
    "20261013120001_create_rfq_catalog_public_reader_runtime.sql": (
        "20b60d611585befc71a881c7566564db236d9ecd33383be785d15373b1d5bd03",
        "5a5eb9d02426d238403b3f74f2f02adbd25e1de30385aa3c314c93ac3ada7ccd",
    ),
}


def without_outer_transaction(data: bytes) -> bytes:
    lines = data.splitlines(keepends=True)
    begin = [i for i, line in enumerate(lines) if line.rstrip(b"\r\n") == b"BEGIN;"]
    commit = [i for i, line in enumerate(lines) if line.rstrip(b"\r\n") == b"COMMIT;"]
    if len(begin) != 1 or len(commit) != 1 or begin[0] >= commit[0]:
        raise ValueError("Expected exactly one outer BEGIN/COMMIT pair")
    return b"".join(line for i, line in enumerate(lines) if i not in (*begin, *commit))


def main() -> None:
    actual = {path.name for path in CANDIDATE.iterdir()}
    if actual != set(EXPECTED):
        raise ValueError(f"Unexpected candidate files: {actual ^ set(EXPECTED)}")
    for name, (original_hash, candidate_hash) in EXPECTED.items():
        original = (ORIGINAL / name).read_bytes()
        path = CANDIDATE / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Candidate must be a regular file: {name}")
        candidate = path.read_bytes()
        if sha256(original).hexdigest() != original_hash:
            raise ValueError(f"Original hash mismatch: {name}")
        if sha256(candidate).hexdigest() != candidate_hash:
            raise ValueError(f"Candidate hash mismatch: {name}")
        if candidate != without_outer_transaction(original):
            raise ValueError(f"Unexpected SQL change: {name}")
        print(f"PASS {name} {candidate_hash}")


if __name__ == "__main__":
    main()
