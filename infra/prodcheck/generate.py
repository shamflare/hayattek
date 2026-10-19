"""Generate fresh secrets (+ optionally a self-signed certificate) for a HayatTek stack.

Local rehearsal (throwaway, git-ignored, with a self-signed cert):
    python infra/prodcheck/generate.py
On the real server — secrets are created there and never leave it:
    python3 generate.py --out /srv/hayat --no-cert
Refuses to overwrite an existing prod.env (that would orphan the database and audio keys).
"""

import argparse
import base64
import json
import os
import secrets
import subprocess
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parent / ".local"
HOST = "hayattek.com"
SEAWEEDFS_UID = 1000


def token(n: int = 32) -> str:
    return secrets.token_urlsafe(n)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--no-cert", action="store_true", help="real server: TLS comes from Let's Encrypt")
    args = parser.parse_args()
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    out.chmod(0o700)
    if (out / "prod.env").exists():
        raise SystemExit(f"{out / 'prod.env'} already exists — not overwriting secrets.")
    pg_pw, s3_key, s3_secret, orthanc_pw = token(), token(12), token(), token()
    (out / "postgres.env").write_text(
        f"POSTGRES_DB=hayat\nPOSTGRES_USER=hayat\nPOSTGRES_PASSWORD={pg_pw}\n", encoding="utf-8")
    (out / "orthanc.env").write_text(
        "ORTHANC__NAME=hayat\nORTHANC__AUTHENTICATION_ENABLED=true\n"
        f'ORTHANC__REGISTERED_USERS={{"hayat": "{orthanc_pw}"}}\n'
        "ORTHANC__DICOM_SERVER_ENABLED=false\nORTHANC__REMOTE_ACCESS_ALLOWED=true\n"
        "ORTHANC__OVERWRITE_INSTANCES=true\nORTHANC__STABLE_AGE=5\n"
        "DICOM_WEB_PLUGIN_ENABLED=true\n", encoding="utf-8")
    (out / "prod.env").write_text("\n".join([
        f"DJANGO_SECRET_KEY={token(50)}",
        f"DJANGO_ALLOWED_HOSTS={HOST}",
        f"CSRF_TRUSTED_ORIGINS=https://{HOST}",
        f"HAYAT_PUBLIC_BASE_URL=https://{HOST}",
        f"DATABASE_URL=postgres://hayat:{pg_pw}@postgres:5432/hayat",
        "REDIS_URL=redis://redis:6379/0",
        "S3_ENDPOINT_URL=http://s3:8333",
        f"S3_ACCESS_KEY={s3_key}",
        f"S3_SECRET_KEY={s3_secret}",
        "S3_BUCKET=hayat-private",
        f"HAYAT_AI_AUDIO_KEY={base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()}",
        "HAYAT_CLAMAV_HOST=clamav",
        "HAYAT_OCR_PROVIDER=apps.documents.ocr.TesseractHttpOcrProvider",
        "HAYAT_OCR_URL=http://ocr:8884",
        "ORTHANC_URL=http://orthanc:8042",
        "ORTHANC_USERNAME=hayat",
        f"ORTHANC_PASSWORD={orthanc_pw}",
        "", ]), encoding="utf-8")
    (out / "backup_passphrase").write_text(token(), encoding="utf-8")
    (out / "s3.json").write_text(json.dumps({"identities": [{
        "name": "hayat", "credentials": [{"accessKey": s3_key, "secretKey": s3_secret}],
        "actions": ["Admin", "Read", "List", "Tagging", "Write"]}]}), encoding="utf-8")

    for f in out.iterdir():
        if f.is_file():
            f.chmod(0o600)
    # SeaweedFS drops to its own user (uid 1000) and must read its credentials file.
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        os.chown(out / "s3.json", SEAWEEDFS_UID, SEAWEEDFS_UID)
    if args.no_cert:
        print(f"Secrets written to {out}")
        return
    live = out / "certs" / "live" / HOST
    live.mkdir(parents=True, exist_ok=True)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",  # noqa: S603,S607
                    "-subj", f"/CN={HOST}", "-addext", f"subjectAltName=DNS:{HOST}",
                    "-keyout", str(live / "privkey.pem"), "-out", str(live / "fullchain.pem")],
                   check=True, capture_output=True)
    print(f"Throwaway rehearsal secrets written to {out}")


if __name__ == "__main__":
    main()
