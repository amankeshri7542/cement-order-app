# Working rules for this repository

These apply to every change, by any person or agent.

1. **Add proper unit tests for each scenario.** Every feature ships with unit tests for its normal path, edge cases, failure paths and each role that can reach it. A bug fix ships with a test that fails without the fix.
2. **Try to break it before calling it done.** After implementing a feature, attack it from different angles and think like an expert penetration tester: other people's data, missing permissions, tampered requests and prices, replayed and duplicate requests, bad input, races and lost connections. Fix what you find, add a test for it, and test again.
3. **Test the backend properly, and keep the design consistent.** Every route gets backend tests against a real database, including refused access and failure cases. Frontend pages use the shared tokens and components, so the design stays similar across pages. Follow DESIGN.md; add to the kit before adding to a page. PRODUCT.md holds who uses each screen and the rules screens must respect.
