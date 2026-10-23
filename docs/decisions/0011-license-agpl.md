# ADR-0011: Learn의 라이선스 — AGPL-3.0-or-later

- 상태: 채택 (2026-10-22) · 관련: 명세 13절 P6·15절 11, ADR-0004(의존성 표), ADR-0010(튜터 백엔드), `LICENSE`, `README.md` "런타임 의존성 라이선스", `docs/spec-amendments.md` 6절
- 근거 합의: 2026-10-22 제품 방향 합의 4c, 3(배포: 공개 오픈소스)

## 맥락
- 배포는 공개 오픈소스로 정했다(합의 3). 명세는 Learn 자체의 라이선스를 정하지 않았고 "의존성·변환기의 라이선스와 배포 적합성을 기록하라"(15절 11), P6 "라이선스"(13절)만 둔다.
- M0의 규칙: "AGPL인 Zotero 코드(reader, note-editor)는 **UX 참고만** 하고 가져오지 않는다. 런타임 의존성은 MIT/ISC/Apache/OFL만 쓴다."(`docs/superpowers/specs/2026-10-20-quality-phase-design.md`, M3 계획 Global Constraints). 이 규칙은 닫힌 앱을 전제로 했다.
- 쓸 만한 AGPL 구성 요소가 있다(2026-10-22, 각 저장소의 LICENSE·COPYING·파일 머리말로 확인):

  | 구성 요소 | 쓰임 | 라이선스 |
  |---|---|---|
  | SingleFile (https://github.com/gildas-lormeau/SingleFile), single-file-core (https://github.com/gildas-lormeau/single-file-core) | 웹 스냅샷(커넥터·재배치 계열) | AGPL-3.0 |
  | Zotero translators (https://github.com/zotero/translators) | 메타데이터 추출 | 저장소 LICENSE 없이 파일 머리말에 적는다. `DOI.js`는 AGPL-3.0-or-later("either version 3 of the License, or (at your option) any later version"), 다른 파일은 확인하지 않았다 |

## 결정
- **Learn은 AGPL-3.0-or-later다.** 저장소 루트의 `LICENSE`는 https://www.gnu.org/licenses/agpl-3.0.txt 를 고치지 않고 그대로 둔 전문이다(2026-10-22 내려받음, 661줄, sha256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`). 루트와 모든 작업 공간(`apps/*`, `packages/*`)의 `package.json`에 `"license": "AGPL-3.0-or-later"`를 둔다.
- **AGPL 구성 요소를 쓸 수 있다.** SingleFile(스냅샷)과 Zotero translators(메타데이터)가 후보다. 실제로 쓸지는 그것이 필요한 마일스톤(M12 재배치 계열, M13 커넥터)에서 정한다.
- **의존성 호환**: 지금의 의존성(MIT/ISC/Apache-2.0/OFL)은 AGPL-3.0과 함께 쓸 수 있다. 배포물에 들어가는 런타임 의존성을 `node_modules`의 `license` 필드로 확인했다(2026-10-22): react·react-dom·zod·better-sqlite3·electron·react-resizable-panels·@tanstack/react-query·zustand(MIT), react-aria-components·pdfjs-dist(Apache-2.0), lucide-react(ISC), Pretendard(OFL-1.1). `@axe-core/playwright`(MPL-2.0)는 테스트 전용이고 배포물에 들어가지 않는다.
- **배포는 GitHub 릴리스로 한다.** Mac App Store로는 배포하지 않는다. 서명·공증은 M14(제품화)에서 한다.
- **외부 기여에는 CLA를 받는다.** 나중에 라이선스를 바꿀 수 있게 남겨 두기 위해서다. CLA 문안과 절차는 M14(AGPL 고지·CLA)에서 정한다.
- **에이전트는 번들하지 않는다.** Claude Code·Codex·Gemini CLI·opencode와 ACP 어댑터, Claude Agent SDK는 사용자가 설치한다(ADR-0010). 그래서 독점 SDK가 Learn 배포물에 섞이지 않는다(Agent SDK는 Anthropic Commercial Terms를 따른다).
- **M0 규칙을 대체한다.** "AGPL 코드는 참고만" 규칙은 더 이상 적용하지 않는다. M3 범위의 의존성은 그대로 MIT/ISC/Apache/OFL이다. 새 의존성의 라이선스를 README 표와 ADR에 기록하는 규칙(ADR-0004)은 그대로다.

## 근거
- SingleFile과 Zotero translators는 AGPL이라 닫힌 앱에는 넣을 수 없었다. Learn이 AGPL이면 넣을 수 있다.
- 오픈소스 배포는 공급사 정책에도 맞는다: OpenAI는 "ChatGPT plan usage is available to open-source projects, personal projects that run locally, and selected private apps."라고 쓴다(https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt, ADR-0010 5절).
- "-or-later"는 Zotero translators의 머리말(`DOI.js`)과 같은 형태다.
- 에이전트를 번들하지 않으면 독점 바이너리(예: Agent SDK의 플랫폼별 네이티브 바이너리, darwin-arm64 약 274 MB)가 AGPL 배포물에 섞이지 않는다.

## 결과
- `LICENSE`와 `package.json`의 `license` 필드를 더했다. 의존성은 바꾸지 않았다.
- AGPL 고지와 CLA는 M14에서 한다.
- 커넥터의 Native Messaging은 브라우저마다의 `NativeMessagingHosts` 폴더에 매니페스트를 써야 한다. 샌드박스 앱(App Store 빌드)이 그 폴더에 쓸 수 있는지는 확인하지 않았다. GitHub 릴리스 배포에서는 이 문제가 생기지 않는다.
- 옛 규칙은 기록 문서(`docs/superpowers/specs/2026-10-20-quality-phase-design.md`, `docs/superpowers/plans/2026-10-20-m1-design-mockups.md`, ADR-0004 맥락, `docs/design/references.md`)에 남아 있다. 이 ADR이 우선한다. M3 계획의 Global Constraints에는 날짜를 붙인 대체 표시를 달았다.
- 재검토 조건: AGPL과 맞지 않는 의존성이나 배포 경로가 꼭 필요해질 때.
