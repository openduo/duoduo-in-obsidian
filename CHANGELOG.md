# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-03-11

### Fixed
- Ensure agent replies are never lost when switching away from Obsidian and back.
- Keep message ordering correct when switching files or panes within the same leaf.

### Changed
- Re-attach the chat input and session when the active file changes in the current leaf.

## [0.1.3] - 2026-03-11

### Fixed
- Restore scroll position reliably using CodeMirror 6 `scrollSnapshot()` after content updates.

### Changed
- Parse timestamps in `MM/DD HH:mm` format for both user and agent messages.
- Improve message formatting for consistent output across roles.
- Refine blockquote visuals in Live Preview and Reading modes (rounded corners, better consistency).

## [0.1.2] - 2026-03-10

- Release 0.1.2.

