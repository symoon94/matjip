# Place Name Search + 500m Radius: Known/Unknown Quadrant Analysis

> Based on feature request: "searchable by a place's name, 500m around the place should be showed up"
> Designed under the constraint that "ship raw results first, add full pipeline later".

---

## Current State Diagnosis

- **Core capability exists**: KakaoMap API already supports `x`, `y`, `radius` params — no new API integration needed
- **Disambiguation is the real problem**: "Any place on KakaoMap" as anchor means multi-result queries are the norm, not the edge case
- **Two surfaces, different optimal anchors**: CLI needs place-name → coordinate resolution; Extension can use map center directly
- **What to stop doing**: Don't integrate full ranking pipeline into this feature yet — distance-only sorting first

---

## Quadrant Matrix

```
                    Known                          Unknown
         +---------------------------+---------------------------+
         |                           |                           |
         |   KK: Systematize         |   KU: Design Experiments  |
 Known   |   Resources: 50%          |   Resources: 30%          |
         |                           |                           |
         +---------------------------+---------------------------+
         |                           |                           |
         |   UK: Leverage            |   UU: Set Up Antennas     |
 Unknown |   Resources: 15%          |   Resources: 5%           |
         |                           |                           |
         +---------------------------+---------------------------+
```

---

## 1. Known Knowns: Systematize (50%)

> Confirmed working items. Build on these directly.

| # | Item | Evidence | Systemization Target |
|---|------|----------|---------------------|
| 1 | **KakaoMap keyword search API supports `x`, `y`, `radius`** | Official API docs; `search.py` already calls this endpoint | Add `x`, `y`, `radius` params to `search_places()` |
| 2 | **`Place` model already has `x`, `y`, `distance` fields** | `models.py` parses coordinates and distance from API response | Use as-is; distance sorting is trivial |
| 3 | **Category filter `FD6` (restaurants) works with radius** | Current impl already filters by category | Combine `FD6` + radius for restaurant-specific nearby search |
| 4 | **Chrome extension has map-bridge.js accessing KakaoMap SDK** | `map-bridge.js` runs in MAIN world, can read map state | Extract current map center coordinates via bridge |
| 5 | **Raw-first + distance sort is the MVP** | User confirmed: distance-only sorting, no fake review detection initially | Minimal new code needed |

---

## 2. Known Unknowns: Design Experiments (30%)

> Questions with no answer yet. Each gets an experiment.

### KU1. How to resolve a place name to coordinates (disambiguation)?

**Diagnosis**: User wants "any place on KakaoMap" as anchor. The same keyword API can search without `FD6` filter to find non-restaurant places, but may return dozens of results. User chose "show top 3, user picks."

**Experiment**:
| Item | Detail |
|------|--------|
| Format | Two-step search: (1) search place name without category filter → show top 3 with name + address, (2) user picks → use selected place's `x`, `y` for radius search with `FD6` |
| Success criteria | Disambiguation resolves correctly for 80%+ of common queries (stations, landmarks, buildings) on first selection |
| Deadline | 1 week from start |
| Effort | ~2-3 hours CLI, ~2-3 hours extension |

**Promotion condition**: Users rarely need to type additional context to find the right anchor place
**Kill condition**: If >50% of queries require "Other" / re-search, switch to "require address hint" strategy

### KU2. How should the CLI UX surface this?

**Diagnosis**: Could be a flag (`--near`) or a separate subcommand. Disambiguation requires interactive selection in CLI.

**Experiment**:
| Item | Detail |
|------|--------|
| Format | `matjip near "서울역"` as new subcommand — cleaner than `find --near`. Shows top 3 places with `rich` prompt, then lists restaurants within 500m sorted by distance |
| Success criteria | Single command, one interactive selection, results in <3 seconds |
| Deadline | 1 week from start |
| Effort | ~2 hours |

**Promotion condition**: Users naturally reach for `matjip near` without checking docs
**Kill condition**: If interaction step feels too slow, pivot to auto-pick-first with `--pick N` override

### KU3. Chrome extension: how to expose both map-center and place-name search?

**Diagnosis**: User wants map center as default + optional place name override. Need UI that makes both discoverable without clutter.

**Experiment**:
| Item | Detail |
|------|--------|
| Format | Add "주변 맛집" button to floating panel that uses map center. Existing search field gets a toggle/mode switch for "nearby place name" search |
| Success criteria | Both modes accessible within 1 click from the panel |
| Deadline | 2 weeks from start |
| Effort | ~4-5 hours (UI + bridge coordination) |

**Promotion condition**: Users use map-center mode >60% of the time (it's the lower-friction path)
**Kill condition**: If map-center extraction from KakaoMap SDK breaks or is unreliable, fall back to place-name-only

---

## 3. Unknown Knowns: Leverage (15%)

> Assets already owned but not utilized. Fastest wins.

| # | Hidden Asset | How to Use | Effort |
|---|-------------|-----------|--------|
| 1 | **`distance` field already parsed in `Place` model** | Use directly for distance sorting — zero new parsing needed | Low |
| 2 | **`map-bridge.js` already accesses KakaoMap SDK in MAIN world** | Can extract `map.getCenter()` for current viewport coordinates | Low |
| 3 | **KakaoMap search API without category filter** | Remove `FD6` filter for the disambiguation step → returns any place type | Low |
| 4 | **`rich` library already in use for CLI tables** | Use `rich.prompt.Prompt` or `rich.table` for disambiguation selection | Low |

---

## 4. Unknown Unknowns: Set Up Antennas (5%)

> Cannot predict. Manage with detection speed + response speed.

| # | Risk/Opportunity | Detection Method | Response Principle |
|---|-----------------|-----------------|-------------------|
| 1 | **KakaoMap SDK API changes break map-bridge.js** | Extension users report "주변 맛집" button stops working; CI test on extension | Fall back to place-name-only mode; map-center is convenience, not required |
| 2 | **500m radius returns 0 results in sparse areas** | Log/display result count; user reports from suburban/rural areas | Show message "500m 내 결과 없음 — 1km로 확장합니다" with auto-expand |
| 3 | **Internal API rate-limiting on two-step searches** | HTTP 429 responses in logs | Add backoff; cache disambiguation results for repeated searches |
| 4 | **Users discover unexpected value in "nearby" for non-restaurant use** | Feature requests for cafes, bars, etc. | Category filter is already parameterized — easy to extend beyond FD6 |

---

## Strategic Decision: What to Stop

| Item | Reason | Restart Condition |
|------|--------|------------------|
| **Full ranking pipeline for nearby results** | Ship raw/distance-sorted results first; fake review detection adds latency and complexity to a feature that should feel instant | Restart when nearby search has >100 weekly uses and users request quality filtering |
| **Custom radius configuration** | 500m fixed is simpler; configurable radius adds UX complexity for marginal benefit | Restart if users consistently report 500m is too small/large for their use cases |
| **Distance-based scoring in main `find` command** | Keep `find` and `near` as separate concerns; don't muddy the existing ranking algorithm | Restart if users want unified search that considers both keyword relevance AND proximity |

---

## Execution Roadmap

### Week 1: CLI MVP
- [ ] Add non-category place search function (disambiguation step)
- [ ] Implement `matjip near "<place>"` subcommand with top-3 selection
- [ ] Add `x`, `y`, `radius` params to `search_places()`
- [ ] Distance-only sorting for results
- [ ] Basic test coverage for new search flow

### Week 2: Chrome Extension
- [ ] Extract map center coordinates via `map-bridge.js`
- [ ] Add "주변 맛집" button to floating panel (map-center mode)
- [ ] Add place-name nearby search mode to panel
- [ ] Handle disambiguation in extension UI (dropdown/list)

### Week 3: Polish + Edge Cases
- [ ] Handle 0-result case with auto-expand to 1km
- [ ] Test with various place types (stations, buildings, parks, cafes)
- [ ] Error handling for disambiguation failures
- [ ] Review: promote KUs to KK or kill

---

## Core Principles

1. **Two-step is one feature**: Disambiguation (place → coords) and radius search (coords → restaurants) are inseparable — ship them together, not as separate PRs
2. **Map center > place name**: For the extension, map center is always the lower-friction path — make it the default, place name is the override
3. **Distance is the only metric that matters for "nearby"**: Don't mix rating/review scoring into nearby results until users ask for it — proximity IS the value proposition
