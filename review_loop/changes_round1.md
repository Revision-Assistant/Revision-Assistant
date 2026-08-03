Round 1 changes implemented:
1. UploadZone FileSlot: removed illegal role="button"+tabIndex container that nested a Clear <button>; container is now a plain drop target and an explicit "browse" button provides the keyboard path. (a11y)
2. Privacy banner: when <2 min remain, an "I'm still working — keep session" button lets the user explicitly extend the session (resets idle timer).
3. Export menu: ArrowUp/ArrowDown/Home/End keyboard navigation between menu items; first item auto-focused on open.
4. "Apply all fixes (N)" renamed to "Apply N safe grammar fixes" with a clearer tooltip stating it never rewrites similarity/AI passages.
5. "Start over" now asks for confirmation before discarding an analysis (stronger wording when un-exported edits exist).
6. Report upload slots: hints now say "PDF only — download or print your Turnitin/iThenticate report as PDF first".
7. PaperView: added a compact colour legend for the highlight categories, and highlight hover titles now show plain-language labels instead of raw category keys.
8. "Draft all AI flags" button got an explanatory tooltip (drafts are review-only, nothing auto-applied).

Skipped (with reasons):
- DOCX export of revised manuscript: new feature outside this UX pass (txt + PDF exports exist).
- Renaming Q1-like/Q2-like score cards: deliberate product naming with explicit disclaimers on-screen and in exports.
- jumpToPage leaving Revised view when selecting an open finding: intentional — open-finding highlights only exist in the original view.
- Grammar batch card & j/k navigation: navigation follows the visible list by design; batch card replaces individual grammar cards.
- High-contrast theme switcher, generic tooltip requests already covered by existing hints/labels: no change.
