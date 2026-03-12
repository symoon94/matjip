# Restaurant Agent - Requirements Specification

## Goal

카카오맵 데이터를 기반으로 4단계 필터링 로직을 적용하여 맛집을 추천하는 **Python CLI 도구**

## Usage

```bash
matjip find "강남 한식"
matjip find "홍대 일식" --top 5
matjip config set-key <KAKAO_REST_API_KEY>
matjip fav add <place_id> <name>
matjip fav list
```

## Filtering Pipeline

### Step 1: 즐겨찾기 매칭
- 로컬 JSON 파일(`~/.matjip/favorites.json`)로 즐겨찾기 관리
- 즐겨찾기에 있으면 +30점 가산

### Step 2: 리뷰 필터링
- `place.map.kakao.com/main/v/{id}` 내부 JSON API로 리뷰 데이터 조회
- 후기 5개 이상, 평균 평점 4.0 이상 필터링
- 미충족 시 -50점 감점

### Step 3: 가짜 후기 탐지 (규칙 기반 MVP)
아래 패턴에 해당하면 의심 플래그 및 -20점/건 감점:
- 같은 날짜에 5점 후기가 3개 이상
- 유사 닉네임 패턴에서 5점 후기 다수
- 7일 내 5점 리뷰 5개 이상 집중
- (향후) LLM 기반 리뷰 텍스트 자연스러움 판별 추가 가능

### Step 4: 트렌드랭킹
- **MVP에서 제외**: 카카오맵 앱 전용 기능으로 API/웹 접근 불가
- 향후 앱 내부 API 분석 시 추가 가능

## Output

Rich 테이블로 상위 N개 식당 랭킹 출력:
- 순위, 식당명, 카테고리, 평점, 리뷰 수, 즐겨찾기 여부, 주의사항, 종합점수

## Technical Decisions

| 항목 | 결정 | 비고 |
|------|------|------|
| 언어 | Python 3.11+ | |
| 형태 | CLI (`matjip`) | Typer + Rich |
| 장소 검색 | 카카오 공식 REST API | `dapi.kakao.com/v2/local/search/keyword.json` |
| 리뷰 조회 | 비공식 JSON API | `place.map.kakao.com/main/v/{id}` |
| 즐겨찾기 | 로컬 JSON 파일 | `~/.matjip/favorites.json` |
| 알바 탐지 | 규칙 기반 | 향후 LLM 고도화 가능 |
| 트렌드랭킹 | MVP 제외 | 앱 전용 기능 |

## Resolved Questions

1. **카카오맵 API 범위**: 장소 검색만 공식 지원. 즐겨찾기/리뷰/트렌드는 API 미제공
2. **인증 방식**: 공식 API는 REST API 키만 필요. 즐겨찾기는 로컬 관리로 대체
3. **리뷰 접근**: `place.map.kakao.com/main/v/{id}` 내부 JSON API 사용 (비공식)
