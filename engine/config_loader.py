from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


class TenantConfigLoader:
    """Loads tenant-specific business configuration from filesystem.

    Engine code should consume only this normalized dictionary and avoid
    embedding tenant business text directly.
    """

    CONFIG_FILES = {
        "prompt": "prompt.json",
        "business_identity": "business_identity.json",
        "contacts": "contacts.json",
        "faq": "faq.json",
        "keyword_intents": "keyword_intents.json",
        "escalation_keywords": "escalation_keywords.json",
        "booking": "booking.json",
    }

    def __init__(self, root: Path) -> None:
        self.root = root

    def load(self, tenant: str) -> Dict[str, Any]:
        tenant_dir = self.root / "tenants" / tenant / "config"
        if not tenant_dir.exists():
            raise FileNotFoundError(f"Tenant config folder not found: {tenant_dir}")

        result: Dict[str, Any] = {}
        for key, filename in self.CONFIG_FILES.items():
            path = tenant_dir / filename
            if not path.exists():
                raise FileNotFoundError(f"Missing tenant config file: {path}")
            result[key] = self._read_json(path)
        return result

    @staticmethod
    def _read_json(path: Path) -> Any:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
