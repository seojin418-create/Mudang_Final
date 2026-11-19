# 무당이 AI공학관 출발 규칙 개선 시뮬레이션

가천대학교 교내 셔틀 무당이를 시뮬레이션으로 재현하고, AI공학관에서 만차인 무당이가 시간표를 기다리는 문제를 줄이는 출발 규칙을 비교한 스마트 교통물류 기말 프로젝트입니다.

- 대시보드: https://seojin418-create.github.io/mudang-simulation/
- 시나리오와 결과 요약: [SCENARIO.md](SCENARIO.md)
- 도로·지도 자료 출처: [DATA_SOURCES.md](DATA_SOURCES.md)

## 비교한 시나리오

| 시나리오 | AI공학관 출발 규칙 |
|---|---|
| 현황 | 앞차 출발 5분 뒤에 맨 앞 차 출발 |
| 제안 1 | 현황 + 만차이고 도착 후 5분 이상 쉬었으면 출발 |
| 제안 2 | 제안 1 + AI공학관 휴게 공간에서 기사가 교대 (기사 1명 추가) |
| 참고 | 만차 즉시 출발 (최소 휴식 없음) |

평균 대기시간(무작위 값 5가지 평균)은 현황 8.7분, 제안 1 1.7분, 제안 2 1.6분입니다.

## 실행

Node.js 24가 필요합니다. 이 폴더에서 다음을 실행한 뒤 터미널에 표시된 주소를 엽니다.

```sh
npm install
npm run dev
```

개발 서버에서는 대시보드 외에 정류장 편집기(`stop-editor.html`)와 입력값 편집기(`input-editor.html`)도 열 수 있습니다. 편집기는 저장할 때 `data/`의 CSV를 바꾸므로 개발 서버에서만 동작합니다.

## 결과 다시 만들기

입력값은 모두 `data/`에 있고, 각 값의 근거(관측·체감·가정·결정)는 CSV의 `source`, `note` 열에 적혀 있습니다.

| 파일 | 내용 |
|---|---|
| `data/stops.csv` | 정류장 순서와 좌표 |
| `data/service.csv` | 운행 시간, 배차간격, 차량 대수, 정원, 정차시간, 최소 휴식, 추가 기사 수 |
| `data/segments.csv` | 직접 잰 하행 구간 시간 |
| `data/demand.csv` | 시간대별 체감 대기 인원과 추정한 도착 인원 |
| `data/destinations.csv` | 내리는 정류장 비율 |
| `data/observations.csv` | 직접 관찰한 기록과 이용 기록, 시뮬레이션과의 비교 |

다음 순서로 실행하면 보고서와 대시보드의 숫자를 다시 만들 수 있습니다.

```sh
npm run build-gtfs                # data/ → gtfs/ 시간표 생성
node scripts/calibrate-demand.mjs # 체감 대기 → 도착 인원 (data/demand.csv의 people)
node scripts/check-queue.mjs      # 체감 대기와 시뮬레이션 대기 비교
node scripts/summary.mjs          # 시나리오별 평균 결과 → results/summary.json
node scripts/sensitivity.mjs      # 민감도 분석 → results/sensitivity.csv
node scripts/rest-check.mjs       # 기사 휴식 시간대별 확인
node scripts/trace-lap.mjs headway 12:00 0   # 차 한 대의 한 바퀴 기록
npm test                          # 시뮬레이션 규칙 테스트
```

보고서 그림은 `node scripts/export-route.mjs` 다음에 `python scripts/figures.py`로 만듭니다(Python, matplotlib 필요).

## 폴더

- `src/`: 시뮬레이션(`simulation.js`), GTFS 읽기, 수요 모형, 대시보드 화면
- `scripts/`: GTFS 생성, 수요 보정, 결과 계산, 그림
- `gtfs/`: 생성된 시간표
- `results/`: 계산 결과
- `test/`: 출발 규칙 테스트

수업에서 제공한 무당이 예제 시뮬레이션을 바탕으로 만들었습니다.
