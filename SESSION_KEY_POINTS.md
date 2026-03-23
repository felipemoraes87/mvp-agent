# SESSION_KEY_POINTS.md

Key cross-project notes from the session relevant to `MVP Agent`.

## Role in the ecosystem

- `MVP Agent` remains the target environment for the `Executive Dashboard Copilot`.
- Both dashboard projects were designed with the expectation that this project will eventually host the real copilot backend behavior.

## Why it matters to the dashboards

- The Streamlit dashboard already includes a mock/real HTTP client contract for the copilot.
- The newer Next.js dashboard also includes a local copilot experience and is a natural future consumer of the same backend contract.

## Practical implication

- When the copilot is made real, the likely workstream is:
  - define the production JSON contract
  - add the `Executive Dashboard Copilot` inside `MVP Agent`
  - connect it first to executive and IAM contexts
  - later expand it to other Security Tribe domains
