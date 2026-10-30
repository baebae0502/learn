# ADR-0010: 튜터 백엔드 — ACP 우선, 사용자 구독, 튜터의 두뇌는 Learn에

- 상태: 제안 (2026-10-22) · T1에서 채택 · 관련: 명세 07·10·12·13·14(AC10·AC11·AC14·AC19·AC20)·15, ADR-0007 §6(비밀값), ADR-0009(앵커 허브), ADR-0011(라이선스), `docs/spec-amendments.md` 2–4절, `docs/design/design-spec.md` 2.5
- 근거 합의: 2026-10-22 제품 방향 합의 3a·3c·3d·3e. 공급사 정책은 2026-10-22에 확인했다.

## 맥락
- 소유자 선호: 사용자가 이미 쓰는 에이전트 구독(Codex, Claude Code, opencode …)으로 로그인해 두 번 돈을 내지 않게 한다. API 크레딧이 아니다.
- 배포는 공개 오픈소스다(ADR-0011). 이것이 공급사 정책에 영향을 준다(5절).
- 명세는 "Provider adapters → remote AI / optional local engine"(07절), P3 "provider interface, fake provider, streaming·취소, RAG·인용·대화"(13절), "키는 OS keychain"(12절), AC10(인용 클릭 → 같은 revision 위치), AC11("선택 자료 밖의 비공개 자료와 제외 기억은 provider 요청에 없다")을 둔다.
- 다른 제품: DeepTutor(https://github.com/HKUDS/DeepTutor, Apache-2.0)는 세 길을 쓴다. (a) Base URL + API 키 공급자 설정, (b) "OpenAI Codex OAuth" — Codex CLI의 OAuth 클라이언트 ID를 재사용하고 비공개 엔드포인트 `chatgpt.com/backend-api/codex/responses`를 직접 부른다(`deeptutor/services/codex_auth/constants.py`), (c) "My Agents" — 사용자의 `claude -p … --output-format stream-json`(기본 `permission_mode` = `bypassPermissions`)과 `codex exec --json`(기본 `sandbox` = `workspace-write`)을 실행한다(`deeptutor/services/subagent/claude_code.py`, `codex.py`). Zed·JetBrains·Obsidian Agent Client·Goose는 ACP로 에이전트를 실행한다.
- 지금 앱에는 네트워크 코드가 없다(렌더러 CSP `connect-src 'self'`, `url-policy.ts`는 http(s) 탐색을 거부).

## 결정

### 1. Learn은 ACP 클라이언트다
- Learn은 설치된 에이전트를 찾아 **수정하지 않은 채** ACP(Agent Client Protocol, https://agentclientprotocol.com, 로컬 에이전트는 stdio 위 JSON-RPC)로 실행한다.

  | 에이전트 | ACP 경로 | 로그인(에이전트가 소유) |
  |---|---|---|
  | Claude | `@agentclientprotocol/claude-agent-acp`(Claude Agent SDK 위의 어댑터, https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp) | Claude 구독(`--cli auth login --claudeai`) 또는 Anthropic Console API 키. 터미널 방식 인증 |
  | Codex | `@agentclientprotocol/codex-acp`(Codex App Server를 띄워 ACP 요청을 옮긴다, https://www.npmjs.com/package/@agentclientprotocol/codex-acp) | ChatGPT 로그인, `CODEX_API_KEY`/`OPENAI_API_KEY` |
  | Gemini CLI | 내장 `--acp`("Starts the agent in Agent Communication Protocol (ACP) mode", https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md) | Google 로그인, Gemini API 키, Vertex AI |
  | opencode | 내장 `opencode acp` | opencode의 공급자 설정(API 키, Ollama 포함) |
  | … | ACP 에이전트 목록의 다른 에이전트 | 에이전트마다 |

- Learn은 에이전트와 어댑터를 싣지 않는다. 사용자가 설치한 것을 찾는다(ADR-0011).
- **로그인은 공급사 CLI에 맡긴다.** ACP의 기본 인증 방식은 "The default authentication method type is `agent`, where the Agent handles authentication itself."(https://agentclientprotocol.com/protocol/v1/authentication)이다. **Learn은 토큰을 보지도 저장하지도 않는다.**
- ACP 판: v1이 안정판이고 v2는 초안이다(2026-07-20 공개, "Don't ship it by default in production until we are closer to stabilization.", https://agentclientprotocol.com/announcements/acp-v2-draft). 어느 판에 맞출지는 T1에서 정한다.

### 2. 에이전트 내장 도구를 끄고, 사용자 설정을 격리하고, Learn의 읽기 전용 MCP만 연다
- **내장 도구(파일·셸)는 끈다.** ACP의 `fs`/`terminal` 기능은 에이전트가 *클라이언트의* 메서드를 부를 수 있는지만 정한다("If `readTextFile` or `writeTextFile` is `false` or not present, the Agent **MUST NOT** attempt to call the corresponding filesystem method.", https://agentclientprotocol.com/protocol/v1/file-system). 클라이언트가 내주지 않아도 에이전트 자신의 도구는 남으므로 에이전트마다 따로 잠근다. 2026-10-22 문서 기준의 손잡이:
  - Claude: `session/new`의 `_meta.claudeCode.options`로 `tools: []`, `settingSources: []`
  - Codex: `CODEX_CONFIG`로 `features.shell_tool = false`, `sandbox_mode = "read-only"`, `web_search = "disabled"`
  - Gemini CLI: `tools.core`(허용 목록) / `tools.exclude`
  - 공통: `session/request_permission`은 거절로 답한다.
  - 손잡이가 실제로 도구를 모두 없애는지(예: Codex `apply_patch`)는 T1에서 에이전트마다 확인한다.
- **사용자 에이전트 설정을 격리한다.** 에이전트는 기본으로 사용자의 `~/.claude`(CLAUDE.md, skills, hooks, MCP)와 `~/.codex`를 읽고, 대화 기록도 그 아래(`~/.claude/projects/…`)에 쓴다. 격리 방법은 T1에서 정한다. `CLAUDE_CONFIG_DIR`/`CODEX_HOME`으로 격리하면 로그인도 격리되어 사용자가 한 번 더 로그인해야 한다.
- **에이전트에 여는 도구는 Learn의 읽기 전용 MCP 서버뿐이다.** ACP는 세션을 만들 때 클라이언트가 MCP 서버를 넘길 수 있다("Clients **MAY** use this ability to provide tools directly to the underlying language model by including their own MCP server.", https://agentclientprotocol.com/protocol/v1/session-setup). 도구는 그 세션에 허용된 범위만 본다.

  | 종류 | 도구 | 시점 |
  |---|---|---|
  | 읽기 | `search_library`, `read_pdf_pages`, `read_transcript`, `get_notes`, `get_context`(선택과 현재 위치), `get_memories`(P4) | T1: PDF 쪽·현재 선택(선택 바구니 — 여러 구간과 각각의 질문), 캡처한 그림(이미지), `@`로 범위에 더한 자료(2026-10-27). M8: 대본. M10: 기억. `search_library`·`get_notes`의 시점은 다음 마일스톤에서 정한다 |
  | 읽기(저장소) | `list_tree`, `read_file(path, lines)`, `search_code` | M11 |
  | 제안 | `propose_note`(앵커가 있는 초안, "노트로 저장"), `propose_check`(확인 문제), `propose_memory`(근거 메시지가 있는 claim 초안, 사용자가 승인·수정) | M9(노트·확인 문제), M10(기억) |
  | 제안(저장소) | 코드 투어(설명이 붙은 여러 앵커의 순서 있는 노트, 한 단계씩 넘긴다), 구조 안내(노트) | M11 |

  - 제안은 사용자가 확인하는 카드로 보인다. **쓰기는 언제나 사용자의 확인을 거친다.**
  - **튜터는 화면을 움직이지 않는다.** 위치 이동은 사용자가 인용 칩을 누를 때뿐이다.
  - 에이전트의 웹 검색은 기본으로 끈다. 나중에 세션마다 켜는 선택지가 될 수 있고, 그때 웹 인용은 link 앵커로 저장한다(ADR-0009).
  - MCP 서버의 전송(localhost HTTP + bearer 헤더 / 앱이 싣는 stdio 실행 파일 / 초안 RFD "MCP-over-ACP")은 T1에서 정한다.
  - 무엇을 보내고 무엇을 읽어 가게 하는지, 도구 결과의 모양, 계열마다 읽는 단위, 그림 전달은 [ADR-0013](0013-presenting-material-to-agents.md)이 정한다.

### 3. 튜터의 두뇌는 Learn에 있다
백엔드와 무관하게 Learn이 한다.
- **맥락 만들기**: 현재 질문 + 사용자 선택 구간 + 허용된 검색 근거 + 관련된 활성 기억(명세 10절). 라이브러리 전체를 보내지 않는다.
- **범위 검사(AC11)**: 에이전트에 넘기는 모든 것(프롬프트와 도구 결과)이 허용 범위 안인지 Learn이 확인한다(`spec-amendments.md` 3절).
- **인용 검증**: 그 턴에 Learn의 도구가 돌려준 쪽·구간만 `message_sources`가 된다. 나머지는 명세 10절대로 "출처 없음" 상태와 원문 근거 답변 재시도로 보인다. Learn은 MCP 서버이므로 도구 호출을 직접 본다. 같은 방식의 선례: DeepTutor 읽기 모드의 `verifiedReadingLocators`("Locators grounded by successful reading-tool results for one turn.", https://github.com/HKUDS/DeepTutor/blob/main/web/lib/reading-citations.ts). 인용 표기 형식은 T1에서 정한다.
- **기억**(P4, M10).
- **대화의 원본은 Learn의 DB다.** 에이전트 쪽 세션 기록은 원본으로 쓰지 않는다.

### 4. 가짜 백엔드, 그리고 나중의 API 키 어댑터
- **가짜 백엔드**가 테스트와 키 없는 설치를 맡는다(명세 15절 8 "API 키가 없어도 앱과 fake-provider 테스트가 실행되어야 한다", AC20). 가짜와 실제는 화면에서 구분한다(명세 15절 4).
- opencode를 ACP로 쓰면 API 키와 Ollama(로컬 모델)도 같은 길로 닿는다.
- **API 키 어댑터**는 나중에 같은 백엔드 인터페이스 뒤에 둔다. OS 키체인은 그때만 필요하다(`spec-amendments.md` 4절). 시점은 1b 로드맵(M3–M14)에 아직 자리가 없다.

### 5. 공급사 정책 (2026-10-22 확인)

| 공급사 | 상태 |
|---|---|
| Anthropic | **모호하다.** 넓게 공개하기 전에 Anthropic의 서면 확인을 받아야 한다(소유자 할 일, M14 출시 전). |
| OpenAI | 로컬·오픈소스 앱에는 허용된다. |
| Google | 공식 CLI를 ACP로 쓰는 것은 문제없다. 토큰을 빼내 쓰는 것은 금지다. |
| opencode | opencode로는 Claude 구독을 쓸 수 없다(opencode 문서, 아래 인용). |

**Anthropic** — 허용 쪽과 승인 필요 쪽이 함께 있다.
- https://code.claude.com/docs/en/legal-and-compliance
  > "**Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."

  > "This does not restrict how customers provision and manage their own API keys … Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above."

  > "Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our Commercial Terms of Service and complying with the conditions below:" / "**The Claude Code binary must not be modified.** Claude Code must be installed and run as published by Anthropic, and customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key)."

  > "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice." / "For questions about permitted authentication methods for your use case, please contact sales"
- https://code.claude.com/docs/en/agent-sdk/overview
  > "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan (2026-10-07 갱신)
  > "You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits."
- 읽기: "unmodified Claude Code binary" 문장과 지원 문서는 허용 쪽을 가리키고, `claude-agent-acp`는 Agent SDK 위의 어댑터라 SDK 문서의 "Unless previously approved"는 승인 필요 쪽을 가리킨다. Anthropic이 2026-05에 발표했다가 2026-06에 멈춘 과금 변경은 "Claude Code through ACP"를 SDK 사용으로 묶었다고 Zed가 전했다(https://zed.dev/blog/anthropic-subscription-changes, 공급사 아닌 2차 출처). Anthropic이 ACP를 직접 다룬 문장은 찾지 못했다. 문서만으로는 정해지지 않으므로 **넓은 공개 전에 서면 확인이 필요하다.** 위의 Commercial Terms 조건이 Learn 같은 앱에 해당하는지도 문서만으로는 분명하지 않다.
- 저장소 공개: 2026-10-23 소유자 결정으로 baebae0502/learn을 공개 저장소로 전환했다. Anthropic 서면 확인은 추후에 받는다.
- 이름: Anthropic 문서는 "Claude Code"나 Anthropic 이름을 자기 제품·기능 이름에 쓰지 못하게 한다(같은 legal 페이지 "Using the Claude Code name and logo"). 에이전트 선택 화면의 표기에 걸린다.

**OpenAI**
- https://developers.openai.com/codex/app-server (learn.chatgpt.com/docs/app-server로 이동)
  > "If you've built a local or open-source application using Codex app-server authentication, you can continue using it, though we recommend migrating to Sign in with ChatGPT so users have greater control over and visibility into their usage. … App-server authentication has never been permitted for commercial or hosted services. We launched Sign in with ChatGPT to support these use cases … Join our partner waitlist here."
- https://developers.openai.com/siwc/quickstart
  > "Sign in with ChatGPT is currently available to selected commercial partners through a limited trial. ChatGPT plan usage is available to all open-source partners and selected private clients."
- https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
  > "ChatGPT plan usage is available to open-source projects, personal projects that run locally, and selected private apps."
- OpenAI는 Sign in with ChatGPT로 옮기기를 권한다. 그 길은 앱이 OAuth 토큰을 받아 app-server에 넘기는 방식이라 1절 "Learn은 토큰을 다루지 않는다"와 맞지 않는다. 옮길지는 정하지 않았다.

**Google**
- https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md
  > "Directly accessing the services powering Gemini CLI (for example, the Gemini Code Assist service) using third-party software, tools, or services (for example, using OpenClaw with Gemini CLI OAuth) is a violation of applicable terms and policies. Such actions may be grounds for suspension or termination of your account."
- ACP 모드는 Gemini CLI가 문서로 제공하는 실행 방식이다(1절 표). 제3자 클라이언트가 공식 CLI를 실행하는 경우를 직접 다룬 Google 문장은 찾지 못했다.

**opencode**
- https://opencode.ai/docs/providers
  > "There are plugins that allow you to use your Claude Pro/Max models with OpenCode. Anthropic explicitly prohibits this. Previous versions of OpenCode came bundled with these plugins but that is no longer the case as of 1.3.0"

  > "Other companies support freedom of choice with developer tooling - you can use the following subscriptions in OpenCode with zero setup: ChatGPT Plus, Github Copilot, Gitlab Duo"

### 6. 비용 (받아들인다)
- **Citations API가 없다.** 에이전트가 API 요청을 직접 만들기 때문이다. 인용은 프롬프트 기반이고 도구 기록으로 검증한다(3절).
- **에이전트마다 도구를 따로 잠근다.** 손잡이가 에이전트·버전마다 다르다(2절).
- **세션 프로세스 하나에 약 250 MB.** Agent SDK 문서: "A spare holds roughly 230 to 260 MB of memory while it waits."(https://code.claude.com/docs/en/agent-sdk/typescript)
- **튜터 사용이 사용자의 코딩 한도를 함께 쓴다.**

### 7. 오른쪽 패널 — 인스펙터
- 오른쪽은 슬롯 하나이고 모드가 있는 인스펙터 [정보 | 튜터]다. 폭은 모드마다 기억한다(정보 320, 튜터 약 380). 모드마다 단축키가 있고, 보기 종류마다 마지막 모드를 기억한다(라이브러리 → 정보, 리더 → 튜터).
- 왼쪽 사이드바에 "세션" 목록(Codex 스레드처럼)과 복습(P4, 명세 02절)이 더해진다. 긴 세션은 탭이 생긴 뒤(M7 이후) 가운데 탭으로도 연다.
- M4는 항목 패널을 모드가 있는 그릇으로 만들고, 튜터가 생기기 전에는 모드 전환을 그리지 않는다(가짜 금지). 자동 접힘 순서는 그대로다: 오른쪽 슬롯 먼저, 그다음 사이드바. 치수와 규칙은 디자인 명세 2.5, 튜터 화면의 모습은 튜터 목업(M5와 병행, 소유자 승인)이 정한다.

### 8. 명세 수정
P3 정의, AC11 범위, 키체인 시점은 `docs/spec-amendments.md` 2–4절에 적는다.

## 미채택과 이유
- **Claude Agent SDK 직접 사용**: Claude 하나만 된다. 플랫폼마다 약 274 MB의 네이티브 바이너리를 싣게 된다(`@anthropic-ai/claude-agent-sdk-darwin-arm64` unpackedSize 274,429,368 bytes, https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/latest). SDK 문서가 구독 로그인에 사전 승인을 요구한다(5절). SDK는 Anthropic Commercial Terms를 따르므로 AGPL 앱에 번들하지 않는다(ADR-0011 "에이전트는 번들하지 않는다").
- **API 키만**: 구독이 있는 사용자가 API 크레딧을 또 낸다. 소유자 선호와 반대다. 나중의 어댑터로 남긴다(4절).
- **DeepTutor처럼 CLI를 직접 실행(`claude -p` / `codex exec`)**: 에이전트마다 다른 headless JSON 형식을 따로 붙여야 한다. DeepTutor의 기본값(`bypassPermissions`, `workspace-write`)은 읽기 전용이 아니다. ACP는 하나의 프로토콜로 Claude·Codex·Gemini·opencode에 닿고 스트리밍·도구 호출·권한 요청을 표준으로 준다. DeepTutor의 "OpenAI Codex OAuth"처럼 공급사 CLI를 흉내 내 비공개 엔드포인트를 부르는 길은 쓰지 않는다.
- **codex app-server 직접 사용**: "The app-server command and WebSocket transport are experimental and aren't supported for production workloads."(https://developers.openai.com/codex/app-server) Codex 하나만 되고, `codex-acp`가 이미 app-server를 감싼다("It starts the Codex App Server, translates ACP requests into Codex operations").

## 결과와 위험
- Anthropic의 입장이 모호하다. 넓은 공개 전 서면 확인이 출시 조건이다(M14). 그 전에도 문서는 "without prior notice" 집행을 말한다. `claude-agent-acp`에는 구독 로그인을 숨기는 `--hide-claude-auth` 옵션이 있다(https://github.com/agentclientprotocol/claude-agent-acp/pull/1079, 2026-09-04 병합).
- 사용자가 에이전트 CLI를 직접 설치하고 로그인해야 한다. `claude-agent-acp`는 Node ≥ 22가 필요하고, `CLAUDE_CODE_EXECUTABLE`로 사용자의 `claude`를 가리키지 않으면 SDK의 네이티브 바이너리를 받는다. Electron의 Node(`ELECTRON_RUN_AS_NODE`)로 어댑터를 돌릴 수 있는지는 확인하지 않았다.
- 답의 품질과 동작이 에이전트·버전마다 다르다. 잠금과 범위는 에이전트마다 T1 테스트로 확인한다.
- T1에서 채울 빈칸: 대화마다 고정된 MCP 범위 토큰, claude.ai 커넥터 끄기, 에이전트별 최소 버전(격리 손잡이가 없으면 튜터를 막는다), 로그인 상태 카드, 대화마다 빈 작업 폴더, 프로세스 감독·취소 시한, 프록시의 루프백 가로채기, 에이전트 자신의 대화 기록 고지 — 근거는 [`docs/research/llm-for-zotero.md`](../research/llm-for-zotero.md) 3절(2026-10-27 조사).
- 재검토 조건: Anthropic이 서면으로 거절할 때, ACP v2가 안정판이 되어 v1과 호환되지 않을 때, 공급사가 이 사용 방식을 막을 때.

## 검증 (T1)
- AC10: 인용 칩 클릭 → 같은 revision의 쪽·시간, 없는 ID는 유효 출처가 아님(가짜 백엔드 계약 테스트).
- AC11(범위 재조정): 에이전트에 넘긴 프롬프트·도구 결과가 허용 범위 안이고, 에이전트의 내장 도구와 사용자 설정이 꺼져 있다.
- AC14: 오프라인·에이전트 실패에서 요청은 실패로 보이고 초안은 남으며 자동 재전송은 없다.
- 명세 12절: 처음 켤 때 동의(공급자와 전송 범위 설명), 요청마다 보낸 자료·발췌·기억 개수 표시.
