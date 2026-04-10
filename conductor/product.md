# Product Guide

## Project Goal
A robust Node.js CLI tool specifically built to test and evaluate Agent Skills locally using an AI agent, following industry-standard evaluation frameworks (Anthropic Evals). The tool enforces strict numeric task identification and provides standardized execution logging and output formatting aligned with Anthropic's recommendations.

## Target Audience
The primary users are Agent Skills Creators who need a reliable way to develop and validate their agent skills.

## Primary Value Proposition
The tool provides a structured way to automate the testing of agent skills using industry-standard concepts (Tasks, Trials, Assertions, and Graders). This includes verifying that skills trigger correctly when expected by consuming structured event streams for reliable activation detection, validating their core functionality through model-based grading, and ensuring they are actually needed for the task at hand.

## Future Scope
The CLI will be expanded with additional commands and grading strategies to test broader aspects of agent skills. While testing skill "triggering" is the initial focus, future iterations will introduce more robust testing for skill "functionality/effectiveness" and skill "need", supporting multiple trials per task for increased statistical significance.

Additionally, while it currently runs evaluations locally using the Gemini CLI, the future scope includes adding support for other AI agents such as Codex or Claude Code.