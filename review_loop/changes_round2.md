Round 1 changes (already shipped):
- FileSlot a11y restructure (no nested interactive controls; explicit browse button).
- Privacy banner "keep session" extend button; export-menu arrow-key navigation.
- "Apply N safe grammar fixes" label + tooltip; Start-over confirmation; Turnitin-to-PDF slot hints.
- PaperView colour legend + plain-language highlight tooltips; Draft-all tooltip.

Round 2 changes (just shipped):
1. FileSlot container no longer re-opens the file picker when a file is already chosen (Clear is the only replace path).
2. Clear buttons now have aria-labels naming the slot and file ("Clear manuscript file X.pdf").
3. Highlight categories now all carry a non-colour cue (solid/dashed/double/dotted/wavy underlines) for colour-blind users; legend swatches show the same patterns.
4. Journal readiness ScoreCards expose role="meter" with aria-valuenow/min/max and a combined label+hint aria-label.
5. Upload fineprint now explains that report passages are matched onto the manuscript and the report itself is never modified.
6. Export menu change-log description mentions pasting accepted edits back into Word/LaTeX source.
7. Grammar batch card button now reads "See each of the N" so users know they can inspect every suggestion before batch-fixing.

Skipped (with reasons):
- Renaming Q1-like/Q2-like cards: deliberate product naming; each card already carries a "checklist, not affiliation" hint and the tab has a prominent disclaimer.
- Leaving Revised view on page jump: intentional — open-finding highlights only exist in the original text view.
- DOCX export: out of scope for this UX pass (change-log copy now explains the Word workflow).
- Claims that the legend lacks labels / export options lack descriptions: not true in the code (both exist).
