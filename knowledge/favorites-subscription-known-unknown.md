# Favorites + Subscription Unified View: Known/Unknown Quadrant Analysis

> Based on feature request: "see all favorite places including subscription"
> Designed under the constraint that "API access for subscription folders is the biggest unknown."

---

## Current State Diagnosis

- **60 folders exist**: Both user-owned folders (기본 그룹, 과천맛집...) and subscribed public folders (내 입맛대로 맛집 by Forecasting, 국내여행 by 쟁고쟁)
- **Subscriptions are just folders**: They appear in the same 즐겨찾기 list — likely accessible via the same `/favorite/timestamp.json` + `/favorite/list.json` API
- **Two separate problems discovered**:
  1. Subscribed folder contents aren't synced (missing data)
  2. Keyword search caps at 45 results (`max_pages=3 × size=15`), so most of 166 favorites in "강남구 맛집" folder are invisible in search results
- **The 45-result cap is the bigger hidden problem**: Even if all favorites sync correctly, `matjip find "강남구"` only pulls 45 places from KakaoMap API → favorites matching can only match within that 45. The user has 166 favorites in one folder alone.
- **What to stop doing**: Don't rely solely on keyword search for favorite-heavy workflows — favorites need their own browsing/search path

---

## Quadrant Matrix

```
                    Known                          Unknown
         +---------------------------+---------------------------+
         |                           |                           |
         |   KK: Systematize         |   KU: Design Experiments  |
 Known   |   Resources: 40%          |   Resources: 40%          |
         |                           |                           |
         +---------------------------+---------------------------+
         |                           |                           |
         |   UK: Leverage            |   UU: Set Up Antennas     |
 Unknown |   Resources: 15%          |   Resources: 5%           |
         |                           |                           |
         +---------------------------+---------------------------+
```

---

## 1. Known Knowns: Systematize (40%)

> Confirmed working items. Build on these directly.

| # | Item | Evidence | Systemization Target |
|---|------|----------|---------------------|
| 1 | **Playwright sync + login flow works** | `sync_favorites.py` successfully logs in and fetches saved places | Extend to include subscription folders |
| 2 | **`/favorite/timestamp.json` returns all folder IDs** | Current code uses this to enumerate folders | Verify it includes subscribed folder IDs too |
| 3 | **`/favorite/list.json` fetches items by folder IDs** | Works for own folders with `type=M` param | Test with subscription folder IDs |
| 4 | **Folder names can be captured from UI** | `_fetch_folder_names_from_ui()` scrapes folder names | Extend to capture owner info (쟁고쟁, Forecasting) |
| 5 | **Favorites stored locally as JSON** | `~/.matjip/favorites.json` with id, name, category, group | Add source field (own vs subscribed) |

---

## 2. Known Unknowns: Design Experiments (40%)

> Higher than default 25% because API access is the #1 risk and the search-cap problem needs a new approach.

### KU1. Does `/favorite/list.json` return subscription folder contents?

**Diagnosis**: Subscribed folders appear in the same UI as own folders. The timestamp API likely returns their IDs. But the list API with `type=M` might filter them out, or subscription folders might use a different content API.

**Experiment**:
| Item | Detail |
|------|--------|
| Format | Open DevTools on map.kakao.com → MY → click a subscribed folder (e.g., "내 입맛대로 맛집") → observe network requests to identify the API endpoint and params |
| Success criteria | Find the API call that returns the 36 items in "내 입맛대로 맛집" |
| Deadline | 1 day |
| Effort | 30 minutes of browser network inspection |

**Promotion condition**: The same `/favorite/list.json` endpoint works with subscription folder IDs → just pass them in the existing sync
**Kill condition**: Subscription folders use a completely different API → need to reverse-engineer a new endpoint

### KU2. How to surface 4,338 favorites as a unified searchable list?

**Diagnosis**: User wants ALL favorites from ALL 60 folders (own + subscribed) as one union — not per-folder browsing. With 4,338 items, need search/filter within the local cache. `matjip find` keyword search (45 max) is fundamentally inadequate for favorites-heavy workflows.

**Experiment**:
| Item | Detail |
|------|--------|
| Format | Enhance `matjip fav list` with `--search` filter that searches name/category/address/group across all 4,338 cached favorites. E.g., `matjip fav list --search "강남"` shows all favorites with "강남" in name, address, or folder name. |
| Success criteria | User can find any saved place instantly from local cache without keyword search API |
| Deadline | 1 week |
| Effort | ~2 hours (filter logic + improved Rich table output with folder names/addresses) |

**Promotion condition**: Users use `fav list --search` more than `find` for familiar areas
**Kill condition**: Local cache is too stale to be useful — users always need fresh API data

### KU3. Periodic sync without manual browser login?

**Diagnosis**: Current sync requires opening a browser, waiting for login. Periodic sync needs either: (a) stored auth cookies that stay valid, or (b) background headless sync using saved `kakao_auth.json` session.

**Experiment**:
| Item | Detail |
|------|--------|
| Format | Test if `kakao_auth.json` (Playwright storage state) stays valid for 7+ days with headless Playwright. If yes, run `matjip fav sync --headless` on a cron/schedule. |
| Success criteria | Auth session survives 7 days without manual re-login |
| Deadline | 2 weeks (needs time to validate session longevity) |
| Effort | ~2 hours to add headless flag + test |

**Promotion condition**: Session stays valid for 7+ days → enable periodic auto-sync
**Kill condition**: Session expires within 1-2 days → keep manual sync, improve the UX instead

---

## 3. Unknown Knowns: Leverage (15%)

> Assets already owned but not utilized. Fastest wins.

| # | Hidden Asset | How to Use | Effort |
|---|-------------|-----------|--------|
| 1 | **`kakao_auth.json` already saved** | Can reuse for headless sync without re-login (if session is still valid) | Low — just add `headless=True` flag to `_launch_browser` |
| 2 | **Folder names already captured in `folder_names.json`** | Show folder names in `fav list` output (currently only shows group ID) | Low — already have the data, just need to join in display |
| 3 | **`fav list` doesn't show addresses/groups** | Favorites already have `address`, `group`, `memo` fields stored — just not displayed | Low — add columns to the Rich table |
| 4 | **Subscribed folder IDs likely already in `timestamp.json`** | The API probably returns ALL folder IDs (own + subscribed) — just haven't verified | Low — test by checking current sync output against 60 folders |

---

## 4. Unknown Unknowns: Set Up Antennas (5%)

> Cannot predict. Manage with detection speed + response speed.

| # | Risk/Opportunity | Detection Method | Response Principle |
|---|-----------------|-----------------|-------------------|
| 1 | **KakaoMap changes internal favorite API** | Sync starts returning 0 results or errors | Pin API response format in tests; log raw responses for debugging |
| 2 | **Subscribed folder owner deletes/changes their folder** | Items disappear from sync; user sees fewer favorites | Track item count per folder across syncs; warn on significant drops |
| 3 | **KakaoMap session invalidation policy changes** | Headless sync fails after shorter intervals | Fall back to manual sync; monitor auth failure rate |

---

## Strategic Decision: What to Stop

| Item | Reason | Restart Condition |
|------|--------|------------------|
| **Relying on keyword search to surface favorites** | With 60 folders and 166+ items per folder, keyword search (45 max results) will never cover them. Favorites need their own browsing path. | Restart if KakaoMap API increases result limit significantly |
| **Displaying favorites without folder context** | `fav list` currently shows flat list without folder names, addresses, or memo — missing context that's already in the data | Never — just show the data you already have |
| **Syncing only on explicit `fav sync` command** | Users forget to sync → stale data → favorites matching misses places | Restart only if periodic sync proves infeasible (session expiry) |

---

## Execution Roadmap

### Week 1: Quick wins + API investigation
- [ ] **KU1 experiment**: Inspect DevTools for subscription folder API calls
- [ ] **UK2**: Show folder names + addresses in `matjip fav list` output (data already exists)
- [ ] **UK4**: Verify if current sync already fetches subscription folder IDs (check count vs 60)
- [ ] Fix `fav list` to show group names, addresses, memo

### Week 2: Sync all folders + browse command
- [ ] Update `sync_favorites.py` to include subscription folder contents (based on KU1 findings)
- [ ] Add source field to favorites (own vs subscribed, with owner name)
- [ ] **KU2**: Build `matjip fav browse "<folder-name>"` command to list all items in a folder
- [ ] Chrome extension: show favorites count in panel

### Week 3: Periodic sync
- [ ] **KU3 experiment**: Test `kakao_auth.json` session longevity with headless mode
- [ ] Add `matjip fav sync --headless` flag
- [ ] If session survives: add `matjip fav auto-sync` with configurable interval

### Week 4: Extension integration
- [ ] Show favorites/subscriptions in Chrome extension panel
- [ ] Favorite markers on map when browsing
- [ ] Review: promote KUs to KK or kill

---

## Core Principles

1. **Favorites-first, not search-first**: For users with 60 folders and hundreds of saved places, browsing favorites IS the primary use case — keyword search is secondary
2. **Show what you already have**: Folder names, addresses, and memos are already stored but hidden — surface them before building new features
3. **Verify before building**: The subscription API question (KU1) takes 30 minutes of DevTools inspection and unblocks everything else — do it first
