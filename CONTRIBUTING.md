# Contributing to BMUX

First off, thanks for taking an interest in BMUX.

BMUX is an independent, evolving open-source project. Contributions, constructive
criticism, bug reports and new ideas are welcome. Whether you're an experienced
developer or someone discovering the project for the first time, there's room to get
involved.

That said, I want to be transparent about how this project is developed and what I
expect from contributions.

## Before You Start

Please take some time to understand the project before making changes.

- Read the README and relevant documentation.
- Explore the existing implementation and architecture.
- Check existing issues and pull requests before opening duplicates.
- If you're considering a significant change, open an issue first so we can discuss the
  approach.

For smaller fixes, documentation improvements and straightforward bug fixes, feel free
to submit a pull request directly.

## What Makes a Good Contribution?

I value contributions that improve BMUX without unnecessarily complicating it.

Some examples:

- Bug fixes and reliability improvements.
- Performance and resource-usage improvements.
- Accessibility and usability improvements.
- Browser compatibility fixes.
- Documentation and examples.
- New commands and functionality that fit the existing design.
- Refactoring that genuinely improves maintainability.
- Tests that help prevent regressions.

A feature being technically possible doesn't automatically mean it belongs in BMUX.
Changes should have a clear purpose and fit the project's overall direction.

## Pull Request Expectations

Please keep pull requests focused and easy to review.

A good pull request should:

1. Explain what problem it addresses.
2. Describe the changes being introduced.
3. Explain why the proposed approach makes sense.
4. Include testing steps or evidence that the change works.
5. Identify any limitations, compatibility concerns or potential regressions.
6. Update relevant documentation when necessary.

A few additional expectations:

- Avoid unrelated changes bundled into a single PR.
- Don't introduce unnecessary dependencies.
- Don't silently change existing command behaviour or interfaces.
- Preserve existing functionality unless a deliberate change has been discussed.
- Don't submit generated files, credentials, personal data or local development
  artifacts.
- Be honest about what has and hasn't been tested.

## Development Philosophy

BMUX is heavily inspired by tmux, and that influence extends beyond its appearance.

Consistency, predictability, composability and keyboard-driven interaction are
important design considerations.

I prefer solutions that are understandable and maintainable over unnecessarily clever
implementations.

When introducing new functionality, consider:

- Does it fit the existing command model?
- Is its behaviour predictable?
- Does it work consistently across panes and windows?
- Does it preserve existing state and functionality?
- Is there a simpler way to achieve the same result?

## Review Process

Submitting a pull request doesn't guarantee that it will be merged.

Contributions may require revisions, additional testing or discussion before they're
accepted.

I reserve the right to:

- Request changes or clarification.
- Suggest alternative implementations.
- Decline changes that don't fit the project's direction.
- Close inactive or incomplete pull requests.
- Prioritize reliability and maintainability over feature quantity.

Please don't take requested changes personally. Code review is about the quality of the
project, not the worth of someone's contribution.

## Reporting Bugs

When reporting a bug, please include as much useful information as possible:

- Browser and version.
- Operating system.
- BMUX version.
- Steps to reproduce the issue.
- Expected behaviour.
- Actual behaviour.
- Relevant console errors or logs, with sensitive information removed.

Screenshots and minimal reproduction examples are especially helpful.

> **Tip:** BMUX tells you its own version in the top menu (`BMUX v1.0.0`, read from the
> manifest) and in the extension menu. `info state` in the overlay prints the theme, the
> window and pane counts, and where the current layout came from; `keys` prints what the
> keyboard actually sent. Those three usually answer the first round of questions.

## Security Issues

Please don't publish exploitable vulnerabilities, authentication tokens, private
browsing data or other sensitive information in public issues.

Report security concerns privately through GitHub's repository security reporting
functionality where available.

## Communication

Be respectful, constructive and willing to discuss different approaches.

Disagreement is perfectly fine. Personal attacks, harassment, hostility and deliberately
disruptive behaviour aren't.

The goal is to build something useful together, not to win arguments.

## A Final Note

BMUX is a project I'm genuinely passionate about. I'm building it because I enjoy this
style of computing and believe there's plenty of untapped potential in bringing
terminal-inspired workflows to the browser.

I don't expect contributors to agree with every decision or approach things exactly as I
would. Independent ideas and thoughtful criticism are valuable.

What I do care about is building something reliable, maintainable and worth using.

Thanks for helping make BMUX better.

— KBS <admin@dtrh.net>
