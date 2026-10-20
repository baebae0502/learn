# ADR-0001: 런타임 — Electron + electron-vite, 단일 앱 스킴

- 상태: 채택 (2026-10-20) · 관련: spec 07, P0 #1·#4·#7

## 맥락
여러 Viewer(PDF·EPUB·슬라이드·웹)와 로컬 영상, 파일 시스템 작업을 한 UI에서 연결해야 한다. 영상 코덱 동작이 OS마다 달라지면 AC05·AC20 검증이 플랫폼별로 갈라진다.

## 결정
- Electron 44 + electron-vite 6 + React + TypeScript. Tauri는 채택하지 않는다.
- renderer는 `file://`이 아닌 `learn://app`(standard·secure·stream 권한)으로 로드하고, 자료도 같은 origin의 `learn://app/asset/<assetId>`로 제공한다.
- `sandbox`, `contextIsolation` 켬, `nodeIntegration` 끔. preload는 `LearnApi`만 노출. IPC 호출자는 프레임 URL(프로토콜+호스트)로 검증하고, 입력은 main에서 zod로 검증한다.
- CSP는 `script-src 'self' 'wasm-unsafe-eval'`이다. pdf.js의 wasm 디코더 때문에 `wasm-unsafe-eval`만 허용하며 `unsafe-eval`은 쓰지 않는다. CSP는 HTML 응답에만 붙는다.
- 자산 응답(`learn://app/asset/*`)에는 `Content-Security-Policy: sandbox; default-src 'none'`을 붙여, 악성 문서가 열려도 스크립트·하위 리소스가 실행되지 않게 한다. 자산 URL은 최상위 탐색 대상이 아니므로 `isAllowedAppUrl`은 `learn://app/asset/*`를 거부한다.
- 경로 탈출, 잘못된·모르는 asset id, Range 206/416 응답은 `tests/e2e/protocol.spec.ts`가 검증한다.

## 근거
- Electron은 Chromium 자체 미디어 스택을 써서 macOS·Windows에서 같은 코덱 표를 가진다. Tauri는 OS 웹뷰(WKWebView/WebView2)에 따라 코덱·API가 달라진다.
- P0에서 `file://` 페이지는 Origin `null`을 보내 호출자를 구분할 수 없었고 pdf.js 요청이 CORS로 막혔다. 같은 origin 스킴은 CORS 예외 없이 해결하고, Electron 보안 권고(커스텀 프로토콜 사용)와도 맞는다.

## 결과
- dev 모드(Vite dev server)에서만 그 origin 하나에 CORS를 허용한다(패키지 빌드에서는 비활성).
- Electron 44 npm 패키지는 postinstall이 없어 바이너리를 첫 실행 때 내려받는다. 느린 네트워크에서는 첫 실행이 멈출 수 있다(README 문제 해결 참고).
- 재검토 조건: 앱 크기·메모리가 제품 요구를 넘거나, Tauri가 영상 코덱 일관성을 보장할 수 있게 될 때.
