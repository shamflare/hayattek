"""Generate THROWAWAY secrets + a self-signed certificate for the local production rehearsal.

Never use these files on a real server: they live in infra/prodcheck/.local/ (git-ignored)
and are regenerated on demand. Real deployments generate their own secrets on the server.
    python infra/prodcheck/generate.py
"""

import base64
import json
import secrets
import subprocess
from pathlib import Path

OUT = Path(__file__).resolve().parent / ".local"
HOST = "hayattek.com"


def token(n: int = 32) -> str:
    return secrets.token_urlsafe(n)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    pg_pw, s3_key, s3_secret, orthanc_pw = token(), token(12), token(), token()
    (OUT / "postgres.env").write_text(
        f"POSTGRES_DB=hayat\nPOSTGRES_USER=hayat\nPOSTGRES_PASSWORD={pg_pw}\n", encoding="utf-8")
    (OUT / "orthanc.env").write_text(
        "ORTHANC__NAME=hayat\nORTHANC__AUTHENTICATION_ENABLED=true\n"
        f'ORTHANC__REGISTERED_USERS={{"hayat": "{orthanc_pw}"}}\n'
        "ORTHANC__DICOM_SERVER_ENABLED=false\nORTHANC__REMOTE_ACCESS_ALLOWED=true\n"
        "ORTHANC__OVERWRITE_INSTANCES=true\nORTHANC__STABLE_AGE=5\n"
        "DICOM_WEB_PLUGIN_ENABLED=true\n", encoding="utf-8")
    (OUT / "prod.env").write_text("\n".join([
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
    (OUT / "backup_passphrase").write_text(token(), encoding="utf-8")
    (OUT / "s3.json").write_text(json.dumps({"identities": [{
        "name": "hayat", "credentials": [{"accessKey": s3_key, "secretKey": s3_secret}],
        "actions": ["Admin", "Read", "List", "Tagging", "Write"]}]}), encoding="utf-8")

    live = OUT / "certs" / "live" / HOST
    live.mkdir(parents=True, exist_ok=True)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",  # noqa: S603,S607
                    "-subj", f"/CN={HOST}", "-addext", f"subjectAltName=DNS:{HOST}",
                    "-keyout", str(live / "privkey.pem"), "-out", str(live / "fullchain.pem")],
                   check=True, capture_output=True)
    print(f"Throwaway rehearsal secrets written to {OUT}")


if __name__ == "__main__":
    main()
