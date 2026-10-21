# Betaflight Blackbox Explorer decoder

Source: https://github.com/betaflight/blackbox-log-viewer
Revision: a84755c5e897c1a3a580424b64c0df066c12c6b4
License: GPL v3; full text in LICENSE alongside this notice.
Copyright: Betaflight / Cleanflight / Blackbox Explorer contributors.
Retrieved: 2026-10-21.

Adaptations by FlightLab (2026): relative module specifiers have `.js`
extensions; the parser's display-only FlightLogFieldPresenter import and
adjustDebugDefsList invocation were removed to avoid a dependency on the
upstream UI. Frame decoding and firmware field definitions are unchanged.

The standalone upstream is feature frozen; newer firmware may require a
decoder update from betaflight/betaflight-configurator. Do not treat an
unknown firmware version as validated for tuning suggestions.
