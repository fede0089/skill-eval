# Initial Concept
A CLI tool for evaluating Agent Skills locally, measuring whether skills trigger reliably and produce the right output using an LLM judge. Supports simultaneous A/B testing against multiple historical versions of a skill.

# Product Guide

## Vision
To provide a robust, deterministic evaluation framework for non-deterministic AI agents, enabling confident iteration on custom skills.

## Target Audience
- **Primary Users:** Developers building and optimizing custom agent skills. They need concrete metrics to validate that their skill improvements actually result in better agent behavior.

## Core Value Proposition
- **Reliability:** Ensuring deterministic evaluation of non-deterministic LLM behavior through statistical aggregation against a baseline.
- **Comparative Analysis:** Enabling simultaneous A/B testing between local development versions and historical references (Git branches/tags) to measure improvements with confidence.

## Future Extensibility Priorities
- **Agent Runners:** The system architecture must prioritize extensibility to support other agent runners (e.g., Claude, OpenAI) in the future.