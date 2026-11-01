"""Only confirmed definitions belong here; demo conditions are never activated."""

from app.modules.risk.schemas import RuleDefinition

# N-U12/17 and the 23 RISK source rows are unresolved in the current specification.
# Populate through a reviewed code change with the condition's policy_source and version.
RULES: tuple[RuleDefinition, ...] = ()
REGISTRY_VERSION = "reviewed-note-rules-v1"
