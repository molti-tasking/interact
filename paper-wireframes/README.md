# Paper Teaser Wireframes

Five visualization concepts for the Malleable Forms UIST '26 paper teaser figure.

Open each HTML file in a browser to see the wireframe. Designed at 1200×800 for paper screenshot capture.

## Concepts

1. **Opinion Convergence Flow** (`01-opinion-convergence.html`)
   The system surfaces structured decision points (opinions) that the user resolves. A convergence bar shows how much of the design space has been narrowed. Cascading: resolving one opinion triggers deeper follow-ups.

2. **Bidirectional Intent-Schema Edit** (`02-bidirectional-edit.html`)
   Split view: the user directly edits a form field (right), and the natural-language intent description updates in real-time (left). Arrows show the propagation direction.

3. **Derivation Diff View** (`03-derivation-diff.html`)
   Side-by-side comparison of a base schema and a derived scenario view (e.g., Surgeon vs. Patient Portal). Shared fields highlighted, additions/removals marked.

4. **Standards Coverage Overlay** (`04-standards-coverage.html`)
   When the system detects domain overlap with an established standard (e.g., FHIR Patient Intake), it shows a coverage map of which standard fields are already present, which are missing, and offers to fill gaps.

5. **Portfolio Provenance Timeline** (`05-provenance-timeline.html`)
   A vertical timeline showing the evolution of an intent portfolio: creation, opinion resolutions, direct edits, derivation branches. Each entry shows who/what triggered the change and the rationale.
