---
name: pr-description-generator
description: "Generates professional, action-focused pull request descriptions in English from code diffs. Use this skill whenever you need to create a PR description that explains what changed and why, without diving into technical implementation details. Trigger this skill when: the user provides a code diff, git changes, or commits and asks for a PR description; they want a template-free description focused on user impact; they're preparing a PR for review and need a clear, business-friendly summary. The skill analyzes the diff to identify feature additions, bug fixes, UI changes, or refactoring work, then produces a structured description with summary, impact statement, deliverables, and optional media guidance."
---

# PR Description Generator

This skill automatically generates professional, human-focused pull request descriptions from code diffs. The output prioritizes **what users experience** and **what gets delivered**, not technical implementation details.

## When to Use This Skill

Use this skill when you have:
- A code diff, git patch, or list of changes
- Commit messages or a brief description of the work
- Need for a polished, English-language PR description

The skill is designed for teams that value clarity and impact over technical minutiae.

## Input Format

The skill expects:
1. **Code diff or changes** (git diff output, file listings, or descriptions of modifications)
2. **Optional context** (type of change: feature, bugfix, refactor, performance, etc.)
3. **Optional testing info** (test files added, test scenarios covered, or notes about test coverage)

## Scope Rules

**Match description length to change size.** Do not pad small changes with unnecessary sections.

| Change size | Output format |
|---|---|
| Trivial (1–2 files, minor fix/rename/copy tweak) | One bold summary line + 1 sentence max. No sections. |
| Small (up to ~5 files, single focused change) | Bold summary + 1–2 sentences. Optionally 2–3 bullets if there are distinct deliverables. |
| Medium / Large (multiple features, significant refactor) | Full structure below. |

## Output Structure

**Trivial / small changes** — keep it to:
```
**[One-line summary]**

[Optional: one sentence if context adds value]
```

**Medium / large changes** — use the full structure:

```
**[One-line summary of the change - bold]**

[1-3 sentence paragraph describing the user-facing impact or behavior change]

## What this delivers:
- [Bullet 1: key feature or improvement]
- [Bullet 2: another deliverable]
- [Bullet 3: etc.]

## [Video | Screenshot]
[Placeholder or actual URL if appropriate]

## Testing:
[Description of test coverage or note about upcoming tests]
```

### Key Principles

1. **Lead with impact**: The summary and opening paragraph should answer: "What can users/developers do now that they couldn't before, or what's better?"

2. **Be specific but non-technical**: Describe observable behavior, not code patterns. For example:
   - ✅ Good: "Submit button is now disabled until all required fields are filled"
   - ❌ Bad: "Implemented form validation hooks with Redux state management"

3. **Deliverables are concrete**: List user-facing features, fixed bugs, new capabilities, or improved workflows — not refactoring, tech debt reduction, or library upgrades (unless they enable something new).

4. **Media is intelligent**: 
   - **Screenshot**: Include if the change adds or modifies UI, touches visual elements, or changes layout
   - **Video**: Include if the change involves interactions, animations, workflows, or complex user journeys
   - **No media**: For backend-only changes, API improvements, performance work, or refactoring
   - Use placeholders if media doesn't exist yet; don't invent URLs

5. **Testing should be honest**: 
   - If tests exist (unit, integration, E2E), describe coverage clearly
   - If tests are planned but not yet written, say so explicitly — don't pretend they exist
   - Mention key test scenarios or edge cases covered

## Analysis Process

When analyzing a diff, the skill:

1. **Identifies the change type** (feature, bugfix, refactor, perf, style)
2. **Extracts user-facing impact** (what behavior changed, what's new, what's fixed)
3. **Lists deliverables** (concrete outputs, new capabilities, removed friction)
4. **Determines media type** (screenshot for UI, video for workflows, none for backend)
5. **Assesses test coverage** (from test files in the diff or notes provided)
6. **Writes the summary** using the structure above

## Example Flow

**Input:**
```
Diff shows: 
- New /app/auth/login.tsx component with form validation
- useAuth hook for session management
- Protected route wrapper component
- 9 E2E tests in auth.spec.ts
- Login redirects auth'd users away, non-auth'd users to /login from protected routes
```

**Output:**
```
**Adds email + password authentication with full route protection**

Users can now sign in and out. Every route except /login is protected — unauthenticated access redirects to the login page, and authenticated users are redirected away from it.

## What this delivers:
- Two-panel login page: sign-in form on the left, marketing content on the right
- Submit button disabled until both fields are filled; error shown inline without layout shift
- Session persists across page reloads and browser tabs
- Sign-out fully invalidates the session server-side
- Profile button in the dashboard header shows the signed-in user's name and handles sign-out

## Screenshot
[placeholder for login page]

## Testing:
9 E2E tests cover the full auth lifecycle: route guard (unauthenticated access), login form behaviour, successful login, sign-out, and post-sign-out re-entry attempt.
```

## Tips for Best Results

- **Provide full diffs or file listings** if possible; partial changes can lead to incomplete descriptions
- **Include test file names and test counts** — they help the skill gauge coverage
- **Mention the "why" if it's non-obvious** — e.g., "This refactor prepares for feature X" or "This fixes the edge case where..."
- **Specify if media exists** — if you have a screenshot or video recorded, provide the URL and the skill will include it

## Notes

- All descriptions are in English, regardless of input language
- The skill avoids jargon and technical depth; it's written for product, design, and non-specialist engineers
- Media placeholders use GitHub's standard syntax but are intentionally generic — users should replace them with real links when media is available
- **This skill only generates text.** It does NOT create commits, push code, open PRs, or perform any git operations. Output the description and stop.
