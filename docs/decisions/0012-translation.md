# ADR-0012: 번역 — 선택한 글을 한국어로, 엔진은 Google(API)

- 상태: 채택 (2026-11-04) · 제안 2026-10-27, M7a에서 구현 · 번역 주소 재확인 2026-11-10(M7c, 공개 문서 읽기만 — 아래 "M7c 재확인") · 관련: 명세 14절 AC14(오프라인), ADR-0007(설정), ADR-0011(라이선스·CLA), ADR-0013(번역은 사람용 — 에이전트에는 원문), `docs/spec-amendments.md` 10절·12절, `docs/research/llm-for-zotero.md`
- 근거: 소유자 결정 2026-10-27 ("A. 넣는다. 엔진은 google api"), 소유자의 Zotero 사용 영상 두 편(2026-10-27, `evidence/owner/`, 저장소 밖)

## 맥락
- 소유자는 영어 논문을 읽으며 Zotero 플러그인 [zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate)(AGPL-3.0, 커밋 2e3d77d 확인)로 선택한 글을 한국어로 바로 본다:
  - 선택하면 Zotero 선택 팝업 안에 번역문이 뜬다.
  - 항목 패널의 "Translate" 칸에 원문과 번역이 위아래로 보인다. 엔진은 Google(API), 방향은 English (United States) → Korean이다.
  - 자동 번역: 선택은 켜고 주석은 끈다.
  - 여러 선택을 잇는 Concat Mode, 지우기, 복사(원문·번역·둘 다)가 있다.
  - 단어 하나를 고르면 사전 뜻이 나온다.
- 원본 명세에는 번역이 없다. Learn은 지금 네트워크 코드가 없다(렌더러 CSP `connect-src 'self'`, `url-policy.ts`는 http(s) 탐색을 거부한다). 번역은 튜터(T1, 에이전트가 네트워크를 쓴다)보다 먼저 오는 **Learn 자신의 첫 원격 요청**이다.
- 그 플러그인의 "Google(API)"는 키 없이 `https://translate.googleapis.com/translate_a/single?client=gtx…`를 부른다(`src/modules/services/google.ts:67, 104`). 공식 Cloud Translation API(키·과금)가 아니라 공개되지 않은 웹 주소다.

## 결정

### 1. 번역은 M7 리더에 들어간다
- **선택 팝업**: PDF에서 글을 고르면 팝업에 번역문이 뜬다(자동, 설정으로 끔).
- **번역 칸**: 원문 칸과 번역 칸, 자동 번역 켜기(선택: 기본 켬, 하이라이트: 기본 끔), 이어 붙이기(여러 선택을 잇는다), 지우기, 복사(원문·번역·둘 다), 방향(원문 언어 자동 → 한국어, 바꿀 수 있음).
- 화면의 자리는 M7a 목업에서 정했다(소유자 "모두 추천대로", 2026-11-03): 선택 팝업 + 오른쪽 인스펙터 정보 모드 맨 위의 "번역" 절. 리더는 PDF가 열려 그려진 동안에만 정보 인스펙터를 둔다. 설정 창에 "번역" 그룹(번역 사용 · 선택하면 번역 · 방향)을 둔다. 튜터 모드 키(⌃⌘1/⌃⌘2)는 바꾸지 않는다.
- 팝업과 번역 절은 **같은 번역 결과를 쓴다 — 요청은 한 번**이다. 새 선택은 이전 요청을 취소하고(R-5), 번역 호출은 캐시를 보기 전에 먼저 진행 중인 요청을 취소한다. 캐시가 답해도 이전 요청이 남아 있지 않게 하려는 순서다.
- 단어 사전, 하이라이트에 번역문 붙이기, 쪽·문서 전체 번역은 이 ADR 밖이다(소유자가 쓰는 것이 보이면 다시 정한다).

### 2. 엔진은 Google(API), 갈아 끼울 수 있게
- 첫 엔진은 소유자가 고른 Google(API)이다(위 주소, 키 없음).
- 엔진은 인터페이스 하나 뒤에 둔다: `translate(text, { from, to }) → { text, detectedFrom, engine }`. 나중의 후보는 공식 Cloud Translation(사용자 키), DeepL(사용자 키), macOS 내장 Translation 프레임워크(기기 안, Swift 도우미 필요), 튜터 에이전트다.
- 플러그인의 코드는 가져오지 않는다(AGPL이고, ADR-0011의 CLA로 나중에 라이선스를 바꿀 길을 남겨 두기 위해서다). 요청 형식은 컨트롤러가 2026-11-03에 직접 확인해 새로 썼다:
  - `POST https://translate.googleapis.com/translate_a/single?client=gtx&sl=<from>&tl=<to>&dt=t`, 본문 `application/x-www-form-urlencoded` `q=<글>`. `sl=auto`는 원문 언어 자동일 때다.
  - 응답은 JSON 배열이다. 번역문은 `r[0]`의 각 조각 `seg[0]`을 이은 것(조각은 원문 문장마다 하나), 감지한 원문 언어는 `r[2]`(예 `"en"`)다.
  - 시험용 영어 문장으로 받은 응답 셋을 `fixtures/translation/`에 두었다(`google-en-ko.json`, `google-auto.json`, `google-ko.json`; 소유자 자료 아님). 응답 해석 단위 시험이 이 파일을 읽는다.

### 3. 네트워크 경계
- 요청은 **main 프로세스만** 한다(Electron `net.fetch`, 시간 제한 10초). 렌더러 CSP는 그대로 `connect-src 'self'`다. 허용하는 원격 호스트는 번역 엔진의 호스트 `translate.googleapis.com` 하나이고, 목록은 `apps/desktop/src/main/net-policy.ts` 한곳에 둔다. https만, 포트가 있으면 거부하고, 리다이렉트는 따르지 않는다(`redirect: 'error'`).
- **동의가 먼저다**: 기기 환경설정 `translation.enabled`가 `null`(아직 묻지 않음, 기본)이면 처음 고를 때 팝업이 동의 요청이 된다 — "선택한 글을 번역하려면 Google로 보냅니다." [번역 켜기] [사용 안 함]. **번역 켜기 전에는 아무것도 보내지 않는다.** 인스펙터 절도 같은 안내와 단추를 보인다. "사용 안 함"이면 팝업이 다시 나오지 않고, 설정에서 언제든 켜고 끌 수 있다. `enabled !== true`이면 main이 `TRANSLATION_DISABLED`로 거부한다(렌더러를 믿지 않는다).
- **오프라인**: "번역할 수 없음 — 인터넷에 연결되어 있지 않습니다"를 표시하고, 자동으로 다시 보내지 않는다(AC14). 사용자가 다시 고르거나 "다시 번역"을 누를 때만 보낸다.
- **캐시**: 키 = sha256(엔진 · 원문 언어 · 대상 언어 · 정리한 원문)으로 번역을 라이브러리 DB의 `translation_cache`(마이그레이션 003)에 저장해 같은 글을 다시 보내지 않는다. 최대 2,000행이고 넘으면 `used_at`이 오래된 것부터 지운다.
- 선택은 5,000자까지, 한 요청은 4,500자 이하로 문장 경계에서 나눈다. 실패는 엔진·상태 코드로 분류해 말한다(막힘·한도 초과·연결 없음).

### 4. 번역은 사람용이다
- 튜터 에이전트에는 원문을 준다. 번역문은 프롬프트에 넣지 않는다(ADR-0013 6절). 답은 질문한 언어로 받는다.

## 미채택과 이유
- **macOS 내장 번역을 첫 엔진으로**: 기기 안에서 돌고 무료라 원칙에 가장 맞지만 Electron에서 부르려면 Swift 도우미가 필요하다. 소유자는 지금 쓰는 엔진을 골랐다. 2절의 인터페이스로 나중에 더할 수 있다.
- **DeepL·공식 Cloud Translation을 첫 엔진으로**: 사용자가 키를 만들어야 한다.
- **튜터 에이전트로 번역**: 느리고 구독 사용량을 쓴다.

## 결과와 위험
- **비공식 주소**: 언제든 막히거나 형식이 바뀔 수 있다. 약관상 위치는 M7c의 문서 조사로도 "불분명"이다 — 두 약관 모두 이 주소를 직접 다루지 않는다(아래 "M7c 재확인 (2026-11-10)" 1). 공개 출시(M14) 전에 소유자가 그 절 3의 선택지 가운데 하나를 고르고, 바꾸면 2절의 다른 엔진을 기본으로 한다.
- 선택한 글이 Google로 간다. 처음 켤 때 알림과 끄는 설정으로 다룬다.
- Learn이 처음으로 바깥과 통신한다. 3절의 경계(main만, 호스트 하나, 동의, 오프라인 표시)가 이후의 원격 기능(T1 에이전트는 에이전트 프로세스가 통신한다)의 본보기가 된다.

## 검증 (M7a)
- 선택 → 팝업에 번역문, 같은 글은 캐시에서(원격 요청 0회).
- 끈 상태와 동의 전에는 원격 요청이 없다(엔진 호출 수를 센다: 가짜 엔진의 `translationCalls`).
- **실제 경로는 가로챈 호스트로 한 번 돈다**(판정 R-17): `LEARN_E2E=1`에 `LEARN_TRANSLATION_NET=intercept`를 더하면 가짜 엔진 대신 실제 google-web 엔진과 `remoteFetch → net.fetch`가 돌고, 기본 세션의 `protocol.handle('https')`가 번역 호스트만 기록된 형식의 고정 응답으로 답한다(다른 https는 403으로 거절하고 센다). 시험은 요청이 정확히 한 번, POST·호스트·경로·본문(글은 본문에만)임을 확인하고 같은 선택은 캐시에서 온다는 것을 본다. 포장한 빌드에서는 켜지지 않는다. 실제 Google의 응답 형식과 망은 이 시험이 보증하지 않는다 — 소유자가 손으로 한 번 해 본다.
- 오프라인에서 표시가 뜨고 자동 재전송이 없다(AC14).
- **가짜 엔진이 정정한 부분**(계획 사전 판정 P-6): E2E(`LEARN_E2E=1`)에서는 **언제나** 가짜 엔진을 쓴다. 환경 변수 `LEARN_TRANSLATION_ENGINE`은 두지 않는다 — 시험이 실수로 Google을 부를 길이 없다. 가짜 엔진은 내장한 실제 번역 표(P-3 응답의 문장)를 먼저 찾고, 없으면 `번역: ` + 정리한 원문을 돌려준다. 시험 훅 `translationFake(mode)`가 모드를 바꾼다(`ok | offline | rateLimited | blocked | unavailable | badResponse | slow`). 요청 수는 엔진 호출 수다(캐시 적중은 세지 않는다). 데모도 이 엔진의 내장 표를 쓴다. CI에서는 실제 URL을 부르지 않는다.
- 실제 Google 호출은 `google-web.live.test.ts` 하나이고 `LEARN_TRANSLATION_LIVE=1`일 때만 돈다(손으로, CI 밖).
- 근거 시험: `tests/e2e/translation.spec.ts`(동의 전 요청 0회 · 팝업과 패널이 같은 결과 · 같은 글은 캐시 · 오류 뒤 자동 재전송 없음과 다시 번역 · 리더를 닫으면 진행 중 요청 취소), 단위 `apps/desktop/src/main/translation/*.test.ts`.

## M7c 재확인 (2026-11-10)

M7c 명세 8절과 소유자 결정 Q4("문서 조사만, 실제 호출 없음")에 따른 조사다. 공개 웹 페이지를 읽기만 했다: 번역 주소(`translate.googleapis.com`)와 다른 번역 API 끝점은 부르지 않았고, `google-web.live.test.ts`를 돌리지 않았으며, 키·계정·폼 입력이 없었다. LibreTranslate와 Zotero 플러그인의 코드는 열지 않았다(문서만). 조사는 읽기 전용 하위 에이전트가 2026-11-10에 했고, 이 절은 그 기록만 옮긴다(컨트롤러 판정 R71).
- **출처 표시**: 칸마다 끝에 [페이지] = 가져온 페이지(또는 데이터 파일)에서 읽음, [요약] = 검색 결과 요약에서만 봄, [못 읽음] = 확인하지 못함.
- **읽기 도구의 한계**: 페이지 읽기 도구는 작은 모델이 페이지를 요약해 돌려준다. 그래서 아래 따옴표 안의 문장은 그 도구가 돌려준 문장이다. 가격 페이지 몇 곳은 본문이 비어 왔다. 소유자가 M14 전에 브라우저로 한 번 대조한다(아래 3, `next-session.md` "M7c 결과").

### 1. 지금 주소의 약관상 위치
대상은 2절의 `https://translate.googleapis.com/translate_a/single?client=gtx…` — 키 없이 부르는, 공개되지 않은 웹 주소다.

| 문서 | 문장(도구가 돌려준 원문) | 지금 주소와의 관계 |
|---|---|---|
| Google 서비스 약관(Effective July 30, 2026) <https://policies.google.com/terms> [페이지] | "using automated means to access content from any of our services in violation of the machine-readable instructions" | robots.txt 같은 기계가 읽는 지침을 어기는 자동 접근을 말한다. 그 주소의 robots 지침은 확인하지 않았다. **불분명** |
| 같은 문서 | "You must not abuse, harm, interfere with, or disrupt our services or systems" | 사용자가 고른 글을 한 번씩 보내는 규모가 여기에 드는지 문서가 말하지 않는다. **불분명** |
| 같은 문서 | "accessing or using our services or content in fraudulent or deceptive ways" | 문서가 말하지 않는다. **불분명** |
| Google API 서비스 약관(Last modified: November 9, 2021) <https://developers.google.com/terms> [페이지] | "You will only access (or attempt to access) an API by the means described in the documentation of that API." (2c절) | `translate_a/single`은 Cloud Translation 문서에 나오는 방법이 아니다(이 조사에서 문서에 없음을 따로 확인하지는 않았다 — 맥락 절이 "공개되지 않은 웹 주소"라 적었다). 이 약관의 "APIs" 정의("Google's APIs, other developer services, and associated software")에 그 주소가 드는지는 **불분명** |
| 같은 문서 | "interfering with or disrupting the APIs or the servers or networks providing the APIs" (4a(4)절, 도구가 돌려준 발췌) | **불분명** |

- 비공식 주소 `translate_a/single`, `client=gtx`를 이름으로 다루는 문장은 두 약관에서 찾지 못했다. 문서가 직접 다루지 않는다.
- 읽은 범위에는 허용한다고 말하는 문장도, 금지한다고 말하는 문장도 없다. 해석은 "불분명"까지만 한다(법률 판단이 아니다).
- 서비스 약관에는 "documented method"라는 문구가 없다(도구의 답: "The page doesn't contain this language").

### 2. 대안 엔진
붙이는 비용은 2절의 인터페이스 `translate(text, { from, to })` 기준이다. 확인 날짜는 모두 2026-11-10이다. 지금 쓰는 비공식 주소는 표에 넣지 않았다.

| 엔진 | 키 / 계정 | 무료 한도 | 기기 안 | 라이선스 | 붙이는 비용 | 출처 |
|---|---|---|---|---|---|---|
| 공식 Cloud Translation(Basic) | Google Cloud 프로젝트가 있어야 하고 청구를 켜야 한다: "You must enable billing to use Cloud Translation." [페이지]. 인증은 서비스 계정·gcloud 같은 Cloud 인증 안내를 따른다(키 한 줄이 아니다) [페이지] | 매달 "First 500,000 characters"가 무료, 넘으면 "$20 per million characters" [요약 — 가격 페이지 본문은 세 번 모두 비어 왔다]. 요청당 권장 최대 "5K code points", 최대 요청 크기 "100K bytes", 프로젝트당 분당 문자 "6,000,000"(v2·v3) [페이지] | 아니오(원격) | 서비스, 약관은 위 Google API 서비스 약관 | 사용자가 프로젝트·청구·인증을 마련해야 해 "키 하나"보다 무겁다. 코드는 같은 호스트의 공식 v2/v3 경로와 인증 헤더 처리로 바꾸고, 허용 호스트 목록은 그대로다 | <https://docs.cloud.google.com/translate/docs/setup> [페이지], <https://docs.cloud.google.com/translate/quotas> [페이지], 가격 <https://cloud.google.com/products/translate/pricing> [요약] |
| DeepL API | 가입과 API 키("choose a plan, and sign up", 번역기 계정이 있어도 새 계정) [페이지]. 카드 요구 [못 읽음] | API Free의 월 한도 [못 읽음](개발자 문서·사용 한도 페이지에 없다). 참고로 번역기 Free는 "50,000 characters per user per month"이고 API와 같은지는 불명 [페이지]. Free 키는 ":fx"로 끝나고 끝점이 `https://api-free.deepl.com`, Pro는 `https://api.deepl.com` [페이지] | 아니오(원격) | 서비스 | HTTP 키 하나(`Authorization: DeepL-Auth-Key …`) [페이지] + 허용 호스트를 `api-free.deepl.com`(또는 Pro)로. 키 종류로 호스트가 갈린다 | <https://developers.deepl.com/docs/getting-started/auth>, <https://developers.deepl.com/docs/getting-started/your-first-api-request>, <https://developers.deepl.com/docs/resources/usage-limits>, <https://www.deepl.com/en/pro-api> |
| Microsoft Azure Translator | 활성 Azure 계정(구독)에서 리소스를 만들고 키·끝점을 복사한다 [페이지]. 카드 요구 [못 읽음] | F0: "2 million characters of any combination of standard translation and custom translation training free per month", "Only one free tier resource is available per subscription", "doesn't expire" [페이지]. 유료 가격 [못 읽음] | 아니오(원격) | 서비스 | HTTP 키 + 지역 헤더 + 허용 호스트를 `api.cognitive.microsofttranslator.com`으로 [페이지]. 사용자가 Azure 리소스를 만들어야 해 설정이 가장 길다 | <https://learn.microsoft.com/en-us/azure/ai-services/translator/create-translator-resource>, <https://azure.microsoft.com/en-us/pricing/details/cognitive-services/translator/> |
| Apple Translation 프레임워크 | 없음 | 가격 문구 없음 | 예. 다만 `init(installedSource:target:)`는 "throws an error if the languages aren't already installed on the person's device" [페이지]. 영↔한 지원 [못 읽음](`LanguageAvailability.supportedLanguages`가 있음은 확인 [페이지]) | Apple 시스템 프레임워크 | Swift 도우미 프로세스가 필요하다. 프레임워크 macOS 14.4 이상, `TranslationSession` macOS 15.0 이상 [페이지]. SwiftUI 없이 쓰는 이니셜라이저의 macOS 최소 판은 따로 확인하지 못했다(Mac Catalyst 26.0 표기는 보임; "macOS 26 이상"이라는 주장은 [요약]이라 미확정). 설치 안 된 언어면 실패하므로 언어 받기 안내가 필요하다 | <https://developer.apple.com/tutorials/data/documentation/translation.json>, `…/translationsession.json`, `…/languageavailability.json` [모두 페이지] |
| Argos Translate | 없음 | 한도 개념 없음(오프라인) | 예(오프라인) [페이지] | "dual licensed under either the MIT License or Creative Commons CC0" [페이지, README·PyPI] | Python 런타임 + 라이브러리 + 모델 패키지를 싣거나 내려받는 자식 프로세스. 영→한 `translate-en_ko` 1.1, 한→영 `translate-ko_en` 1.1 패키지가 있다 [페이지, 색인 데이터]. 파일 크기 [못 읽음](색인에 크기 필드 없음). Python 최소 판은 PyPI ">=3.5" [페이지]. 번역 품질은 비교하지 못했다 | <https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json>, <https://github.com/argosopentech/argos-translate>, <https://pypi.org/project/argostranslate/> |
| LibreTranslate | 호스팅 서비스(libretranslate.com)는 `api_key` 매개변수와 portal.libretranslate.com에서 받는 키 [페이지]. 자체 호스팅이면 키 없음 [페이지] | 호스팅 서비스에 무료 계층이 없다: 체험 여부 질문에 "No, but we have a 7 days money-back guarantee", Pro $29/month · Business $58/month, 호출당 "2,000 character limit", Pro 분당 80회(burst) [페이지]. 무료 공개 인스턴스의 키 요구 [못 읽음] | 자체 호스팅이면 예("running the software on your own machine for free", pip 설치 · 로컬 5000번 포트) [페이지]. 호스팅 서비스는 원격 | "License: AGPLv3" [페이지, 홈과 문서 둘 다] | 자체 호스팅: 서버 프로세스를 앱에 묶어야 하고 AGPL과 ADR-0011(CLA, 라이선스 변경 여지)이 맞는지 따로 판단해야 한다(법률 판단 아님, 확인하지 못함). 호스팅 서비스: 유료 키 + 허용 호스트. 영↔한은 en→ko, ko→en 모두 문서에 있다(115 MB·113 MB는 Argos 모델 크기 표기) [페이지] | <https://libretranslate.com/>, <https://docs.libretranslate.com>, <https://portal.libretranslate.com>, <https://docs.libretranslate.com/guides/supported_languages> |

### 3. M14 전에 소유자가 정할 것
선택지와 그 대가(조사가 말하는 것만):
1. **비공식 주소를 그대로 둔다** — 약관상 위치가 "불분명"인 채 공개 출시하고, 막히면 번역이 멈춘다(동의 화면은 이미 Google로 보냄을 알린다). 비용 0.
2. **공식 Cloud Translation으로 바꾸고 사용자가 키를 만든다** — 사용자마다 Google Cloud 프로젝트와 청구 켜기("You must enable billing")가 필요하다. 코드는 공식 경로와 인증 처리로 바꾼다. 무료 한도(매달 50만 자, [요약]) 안이면 0원이고 약관상 위치는 분명하다.
3. **DeepL 또는 Azure(F0 매달 200만 자)를 키 방식으로 더한다** — 가입 단계가 있고, 두 서비스 모두 카드 요구 여부를 읽지 못했다. DeepL API Free의 월 한도도 읽지 못했다. 엔진이 둘 이상이면 설정 화면과 캐시 키(엔진별)가 는다.
4. **Apple Translation을 기기 안 엔진으로 더한다** — Swift 도우미와 Mac 전용 분기가 생긴다. 영↔한 지원은 확인하지 못했고, 언어 모델을 사용자가 먼저 받아야 하며(없으면 오류), 최소 판은 프레임워크 14.4 · 세션 15.0이다. 네트워크 경계와 동의 화면이 필요 없어진다.
5. **Argos 같은 오프라인 번역을 번들한다** — Python 런타임과 영→한·한→영 모델 둘이 설치 크기를 키운다(크기는 확인하지 못함 — 참고로 LibreTranslate 문서가 같은 쌍을 115 MB·113 MB로 적는다). 번역 품질은 비교하지 못했다. 네트워크가 없다.
6. **번역을 M14에서 빼거나 "사용자가 켜면 비공식 주소" 실험 기능으로 표시한다** — 소유자가 쓰는 기능이 줄거나, 위험을 사용자에게 알려야 한다.

결정 전에 브라우저로 확인할 값(이 조사에서 확정하지 못한 것, R71): Cloud Translation의 무료 한도(매달 50만 자)와 초과 가격(100만 자당 $20) — [요약]뿐 · DeepL API Free의 월 한도와 카드 요구 · Azure F0의 카드 요구와 유료 가격 · Apple Translation의 영↔한 지원과 SwiftUI 없이 쓰는 이니셜라이저의 macOS 최소 판 · Argos 모델 파일 크기 · LibreTranslate 무료 공개 인스턴스의 키 요구. 앱 안의 실제 번역이 지금도 되는지는 소유자가 직접 돌리는 확인으로 본다(`next-session.md` "M7c 결과"의 소유자 할 일).
