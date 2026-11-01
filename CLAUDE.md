# CLAUDE.md

## Project: Flagship

A local feature flag management platform with a functional demo e-commerce application.

This file defines the principles, development workflow, and expectations that apply throughout the project. The project specification and explicit user decisions take precedence over assumptions or implementation preferences.

---

## 1. Core Working Principles

### Clarify before assuming

- Do not invent requirements, silently fill knowledge gaps, or make product decisions on the user's behalf.
- If a requirement, expected behavior, architectural decision, or technical detail is unclear and could materially affect the implementation, stop and ask the user before proceeding.
- Ask focused questions. Group related questions together rather than interrupting the workflow with a series of small questions.
- When presenting alternatives, briefly explain the trade-offs and recommend one where appropriate.
- Never present an assumption as an established requirement.
- For genuinely inconsequential implementation details, use the simplest conventional solution. Make the decision visible if it could become relevant later.

### YAGNI — You Aren't Gonna Need It

- Implement only what is required by the current project scope.
- Do not build abstractions, extension points, configuration systems, or infrastructure for hypothetical future requirements.
- Avoid premature generalization and unnecessary flexibility.
- Prefer straightforward solutions over elaborate architectural patterns.
- Do not introduce additional dependencies without a concrete reason.
- Do not build features merely because they might be useful someday.
- Keep the implementation easy to understand, maintain, test, and extend when an actual need arises.

### Think before implementing

- Understand the existing code and architecture before making changes.
- Identify the smallest reasonable implementation that solves the problem.
- Consider the impact on existing functionality before modifying shared components, interfaces, or data structures.
- Do not perform broad refactors when a focused change is sufficient.
- Do not overwrite or remove existing functionality without understanding its purpose.
- If a proposed change significantly affects the architecture or project scope, discuss it with the user first.

---

## 2. Development Workflow

Follow this workflow for non-trivial tasks:

1. **Understand:** Inspect the relevant code, documentation, and existing implementation.
2. **Clarify:** Identify ambiguities, missing requirements, and important decisions. Ask the user when clarification is needed.
3. **Plan:** Briefly explain the proposed approach, especially when multiple files, components, or architectural layers are involved.
4. **Implement:** Make focused, incremental changes. Avoid unnecessary modifications.
5. **Verify:** Run relevant tests, checks, and builds. Do not assume an implementation works without verifying it.
6. **Report:** Summarize what changed, what was verified, and any remaining limitations or decisions.

For small, straightforward changes, avoid unnecessary planning overhead. Use judgment while preserving the principles above.

### Implementation discipline

- Do not leave broken, incomplete, or misleading functionality behind.
- Do not replace real functionality with hardcoded values, mock data, or visual placeholders unless explicitly requested.
- Keep frontend, backend, and shared types consistent.
- Validate important business rules on the backend, not only in the frontend.
- Handle loading, error, empty, and success states where relevant.
- Prefer deterministic and reproducible behavior.
- Keep business logic separate from presentation logic.
- Write tests for important business logic and behavior, particularly where incorrect results could cause configuration or data integrity problems.
- Do not claim that something has been tested unless the relevant test or check was actually executed.

---

## 3. Project-Specific Priorities

### Functional correctness first

Flagship must be a genuinely functioning application, not a static UI prototype.

- The dashboard, feature flag service, and demo storefront must use the same backend and persisted configuration.
- Feature evaluations must be performed by the actual evaluation engine.
- Changes made through the dashboard must affect the demo storefront.
- Configuration must persist across application restarts.
- Feature evaluation and rollout assignment must be deterministic.
- Configuration validation and permission enforcement must happen on the backend.
- Audit history must accurately represent configuration changes.

Do not simulate functionality in the frontend when the underlying backend behavior should exist.

### Architecture

Follow the stack and architectural decisions established in the project specification.

- Use TypeScript consistently across the application.
- Maintain clear boundaries between frontend, backend, and shared code.
- Keep the backend API as the source of truth for feature flag configuration and evaluation.
- Feature evaluation and validation live in the API. The frontend must never independently determine feature flag outcomes.
- All configuration changes go through the central save-and-audit function (`applyConfig` in `apps/api/src/services/flags.ts`), so persistence, audit history and live updates cannot be bypassed.
- Avoid unnecessary abstraction layers and excessive indirection.
- Keep interfaces and data models explicit and consistently typed.
- Prefer existing project conventions over introducing new patterns.

If the architecture needs to change substantially, explain why and ask before proceeding.

### User interface and experience

The application should feel like a polished, professional developer-oriented product.

- Prioritize clarity, usability, and information hierarchy.
- Use a restrained dark visual direction with purposeful accent colors.
- Use consistent spacing, typography, borders, and component patterns.
- Add subtle animations and transitions where they improve the experience.
- Avoid generic admin-dashboard layouts, decorative clutter, excessive gradients, and oversized cards.
- Do not sacrifice usability or information density for visual effects.
- Ensure the interface works at common desktop and mobile sizes.

Do not introduce a new design system or UI library without a clear reason.

---

## 4. Code Quality

- Write readable, maintainable, and appropriately simple code.
- Use descriptive names and explicit types.
- Avoid duplicated business logic.
- Avoid unnecessarily large components and functions.
- Extract shared logic when there is a real reuse or maintainability benefit.
- Avoid abstractions that make simple behavior harder to follow.
- Handle errors explicitly rather than silently swallowing them.
- Remove unused code and dependencies when appropriate.
- Keep comments focused on explaining non-obvious reasoning, not restating the code.
- Follow existing formatting, linting, and naming conventions.
- React effects must have correct cleanup behavior: an effect callback returns only `undefined` or a valid cleanup function, and subscriptions and event listeners are cleaned up. Use a block body when an effect does several things or its cleanup would otherwise be unclear.

Do not make unrelated cleanup changes during focused tasks.

---

## 5. Documentation and Project Knowledge

Keep documentation useful, concise, and accurate.

- Update documentation when implementation changes make it inaccurate.
- Do not document hypothetical features that do not exist.
- Keep setup instructions, architecture descriptions, API documentation, and important development decisions aligned with the actual implementation.
- Prefer updating existing documentation over creating multiple overlapping documents.

### CLAUDE.md maintenance

This file should evolve as the project develops.

If you discover information that would materially improve future development sessions, such as:

- An important architectural decision.
- A recurring implementation constraint.
- A project-wide convention.
- A non-obvious technical limitation.
- A lesson learned that should prevent repeated mistakes.

Then explicitly suggest updating `CLAUDE.md` to include it.

Explain what you recommend adding and why. Ask the user for approval before modifying this file.

Do not add temporary task details, redundant instructions, or information already documented elsewhere. Keep this file concise and useful.

---

## 6. Communication Expectations

Act as a critical engineering partner, not simply an implementation assistant.

- Challenge questionable requirements and point out potential problems.
- Explain meaningful technical trade-offs.
- Recommend simpler alternatives when a proposed solution is unnecessarily complex.
- Be honest about limitations, technical debt, and incomplete work.
- Do not agree with a suggestion just to be agreeable.
- Avoid lengthy explanations when a concise answer is sufficient.
- Do not make significant product or architectural decisions without the user's input.

The objective is to build a polished, technically sound project through an efficient, iterative AI-assisted development workflow.

**When in doubt, clarify. When implementing, keep it simple. When something works, verify it.**