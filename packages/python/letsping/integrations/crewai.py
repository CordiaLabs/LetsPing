from typing import Type

from pydantic import BaseModel, Field

from .. import LetsPing, Priority

try:
    from crewai.tools import BaseTool
except ImportError as e:  # pragma: no cover - only hit when CrewAI is missing at runtime
    raise ImportError(
        "letsping.integrations.crewai requires the 'crewai' package. "
        "Install it with: pip install crewai"
    ) from e


class LetsPingToolInput(BaseModel):
    """Input schema for LetsPingCrewTool."""

    context: str = Field(
        ...,
        description="JSON or natural language describing the high‑risk action LetsPing should govern.",
    )


class LetsPingCrewTool(BaseTool):
    """
    Native CrewAI tool that routes risky operations through LetsPing's behavioral firewall
    and Human‑in‑the‑Loop approval flow.

    Example:
        from letsping import LetsPing
        from letsping.integrations.crewai import LetsPingCrewTool

        lp = LetsPing()
        secure_refund = LetsPingCrewTool(
            lp=lp,
            service="cx-agent",
            action="stripe:refund",
            priority="critical",
            name="lets_ping_secure_refund",
            description="Safely route Stripe refunds through LetsPing for human approval.",
        )
    """

    lp: LetsPing
    service: str
    action: str
    priority: Priority = "medium"

    name: str = "lets_ping_human_approval"
    description: str = (
        "Route high‑risk actions through LetsPing for behavioral firewall checks and human approval."
    )
    args_schema: Type[BaseModel] = LetsPingToolInput

    def _run(self, context: str) -> str:
        tool_fn = self.lp.tool(self.service, self.action, self.priority)
        return tool_fn(context)

