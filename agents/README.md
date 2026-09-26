# Agents — Shared Framework

**Owners:** A1 (Discovery), A2 (Planning + orchestrator), A3 (Blueprint), A4 (Cutover).

All four agents share one small framework in `agents/common/`. **Build it in hours 0–2** (A2 leads; everyone reviews).

## Layout

```
agents/
├── common/
│   ├── llm.py         # Bedrock client wrapper + fallback to Anthropic API
│   ├── tools.py       # @tool decorator, registry, arg validation, allowlist guard
│   ├── loop.py        # run_agent(system, user, tools, max_turns) tool-calling loop
│   ├── models.py      # Pydantic models from docs/CONTRACTS.md
│   ├── store.py       # SQLite: apps, tiers, edges, waves, blueprints, cutovers, events
│   ├── events.py      # emit(agent, app_id, type, payload)
│   └── aws.py         # sessions: target(), legacy() via AssumeRole
├── discovery/  planning/  blueprint/  cutover/
└── fixtures/          # sample JSON matching CONTRACTS (commit in hour 1)
```

Each agent exposes one entry point, `run(**kwargs) -> result`, and a CLI:

```bash
python -m agents.discovery --scope real
python -m agents.planning --capacity 40
python -m agents.blueprint --app app-catalog --apply
python -m agents.cutover --app app-catalog
```

## LLM client

```python
# agents/common/llm.py
import os
from anthropic import AnthropicBedrock, Anthropic

MODEL = os.environ["LLM_MODEL_ID"]   # the Claude model ID enabled in Bedrock for your region

def client():
    if os.getenv("LLM_BACKEND", "bedrock") == "bedrock":
        return AnthropicBedrock(aws_profile="mig-target", aws_region=os.environ["AWS_REGION"])
    return Anthropic()               # fallback: ANTHROPIC_API_KEY
```

Confirm the exact model ID in the Bedrock console once access is granted, and put it in `.env`.

## Tool-calling loop (the whole "agent")

```python
# agents/common/loop.py  (sketch)
def run_agent(system, user, tools, max_turns=8):
    msgs = [{"role": "user", "content": user}]
    for _ in range(max_turns):
        r = client().messages.create(model=MODEL, max_tokens=2000, system=system,
                                     tools=[t.schema for t in tools], messages=msgs)
        msgs.append({"role": "assistant", "content": r.content})
        calls = [b for b in r.content if b.type == "tool_use"]
        if not calls:
            return r
        results = []
        for c in calls:
            out = registry[c.name].invoke(c.input)          # validates + allowlist-checks
            emit(agent=..., type="TOOL_CALL", payload={"tool": c.name, "input": c.input})
            results.append({"type": "tool_result", "tool_use_id": c.id, "content": json.dumps(out)})
        msgs.append({"role": "user", "content": results})
    raise RuntimeError("max_turns exceeded")
```

## Rules every agent follows

1. **Deterministic first, LLM second.** Rules handle the 80% case. Claude handles ambiguity, mapping and explanations. Every agent must still produce a usable result if `LLM_BACKEND=off`, since that is the demo safety net.
2. **Structured output only.** Force JSON through a tool call (for example `submit_tiering`), then validate it with Pydantic. On a validation error, retry once, then fall back to rules.
3. **Guarded actions.** Mutating tools check that the target resource is in Account B and carries the tag `managed-by=migration-accelerator`.
4. **Emit events** for every meaningful step. The dashboard is only as live as your events.
5. **Idempotent.** Re-running an agent on the same app must be safe (upsert, not insert).
6. **Timeboxed.** Each LLM call has a timeout (20 s). Slow or failed calls fall back to rules.

## Integration milestones

| Hour | Milestone |
|---|---|
| 2 | `common/` merged, fixtures committed |
| 8 | Each agent runs on fixtures from the CLI |
| 20 | Each agent runs on real accounts from the CLI |
| 26 | Orchestrator calls all four, and events show in the UI |
| 32 | Full dry run from the dashboard |

## Testing

- `pytest agents/` runs against fixtures, with the LLM mocked by `LLM_BACKEND=mock` returning canned tool calls.
- One smoke script, `scripts/e2e_real.sh`, runs the whole chain against the real accounts for app-catalog.
