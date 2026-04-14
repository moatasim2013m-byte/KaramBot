from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from engine.config_loader import TenantConfigLoader


class KaramBotEngine:
    """Generic engine that executes behavior from tenant configuration."""

    def __init__(self, project_root: Path, tenant: str = "karambot") -> None:
        self.tenant = tenant
        self.config = TenantConfigLoader(project_root).load(tenant)

    def system_prompt(self) -> str:
        return self.config["prompt"]["system_prompt"]

    def business_name(self) -> str:
        return self.config["business_identity"]["name"]

    def contacts(self) -> Dict[str, str]:
        return self.config["contacts"]

    def faq(self) -> List[Dict[str, str]]:
        return self.config["faq"]["items"]

    def keyword_intents(self) -> Dict[str, List[str]]:
        return self.config["keyword_intents"]

    def escalation_keywords(self) -> List[str]:
        return self.config["escalation_keywords"]["keywords"]

    def booking_text(self) -> Dict[str, Any]:
        return self.config["booking"]
