# Functional Test Results

Run each test against the connected Supabase implementation. Do not mark PASS until observed.

| Test | Input/action | Expected result | Actual result | Pass/Fail | Evidence file |
|---|---|---|---|---|---|
| TC01 | A01: GWA 1.75, 18 units, zero counts, exactly deadline | Compliant | Not run | Not run | |
| TC02 | A02: GWA 1.76 | With Deficiency: GWA | Not run | Not run | |
| TC03 | A03: Community, GWA 2.25, 15 units, 1 drop | Compliant | Not run | Not run | |
| TC04 | A04: 14 units, 1 incomplete | With Deficiency: units and incomplete | Not run | Not run | |
| TC05 | A05: 1 failed, one minute late | With Deficiency: failed and late | Not run | Not run | |
| TC06 | A06 pending verification; evaluate/approve | Both actions blocked | Not run | Not run | |
| TC07 | Duplicate semester; GWA 0.50; negative count | Rejected with clear error | Not run | Not run | |
| TC08 | Scholar attempts another scholar's record and staff action | Backend denies | Not run | Not run | |
| TC09 | Return, correct, resubmit, refresh | Pending verification and history preserved | Not run | Not run | |
| TC10 | Staff approves compliant and holds deficient; scholar tries decision update | Correct decision; scholar denied | Not run | Not run | |
