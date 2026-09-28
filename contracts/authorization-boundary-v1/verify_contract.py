#!/usr/bin/env python3
"""Verify that Community retains complete standalone local authorization."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = Path(__file__).with_name("manifest.json")

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
if manifest.get("version") != 1:
    raise SystemExit("unexpected authorization-boundary version")

composition = manifest["composition"]
if composition["community_requires_organization"]:
    raise SystemExit("Community authorization must not require an organization")
if composition["organization_policy_can_bypass_local_enforcement"]:
    raise SystemExit("organizational policy must not bypass local enforcement")

permission_source = (ROOT / manifest["public_permission_source"]).read_text(encoding="utf-8")
for required in ("PERMISSION_SCOPES", "PermissionSet", "checkPermission"):
    if required not in permission_source:
        raise SystemExit(f"missing public local authorization symbol: {required}")

access_control = (ROOT / "firmware/backbone/include/spaghetti/access_control.h").read_text(encoding="utf-8")
for required in ("spaghetti_role", "spaghetti_permission", "spaghetti_principal_authorize", "spaghetti_audit_record"):
    if required not in access_control:
        raise SystemExit(f"missing firmware local authorization symbol: {required}")

print("Authorization boundary verified: version=1 fallback=LOCAL_ONLY")
