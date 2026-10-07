# Fresh main integration and C8 error/focus repair

The candidate integrates reviewed main `251823a5b1b78818593e14be1a8ac8be47e321f4` (MTM PR604) after `d97e8ba8c276d62a01c1f0de4a3ce7ee15dbb6cd`. Eight incoming MTM files retain exact main blobs. Each EN/RU/AZ catalog adds exactly four incoming MTM keys while retaining all accepted HRM keys and the new safe Today error messages. PR589 remains unchanged at `a856a9e533c4f3cec6f2313e69f5be0d5b4d4226`.

Today now maps denied, expired and unavailable reads to localized safe messages, strengthens sampled text/link contrast, and adds eight CSS pixels of scroll margin to its retained pagination control. The prior hosted browser failed when fractional native zoom placed its bottom 0.5px beyond the integer viewport. The focus predicate and timeout are unchanged. Historical negative, original AT archives and original review receipts remain preserved.

The integrated tree passed 130 targeted tests with no failures/skips, scoped ESLint with zero errors/warnings and i18n parity. Existing hosted full compiler, unchanged baseline gates, production build and browser lanes must validate the resulting exact head; prior-head success is historical only. This checkpoint does not close WF-C8-002 or change the 83/161 ledger, and authorizes no merge/deploy/activation.
