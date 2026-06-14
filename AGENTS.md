# Repository Guidelines

## 專案結構與模組劃分

本專案為純靜態網站，核心前端放在 `public/`：

- `public/index.html`：頁面骨架與查詢介面。
- `public/app.js`：搜尋、收藏、分頁、連結與分享邏輯。
- `public/styles.css`：版面與元件樣式。
- `public/dict_idioms_2020_20260324.min.json`：前端載入的精簡資料來源。
- `dict_idioms_2020_20260324.*`：原始與精簡資料版本（根目錄）供比對與更新。
- `build/`、`downloads/`：中繼/備份資料資料夾。
- `docs/`：補充文件與規格說明。

## 建置、執行與本地開發

- `make serve`：以 `public/` 啟動本地伺服，預設 `http://127.0.0.1:8000/`，並嘗試使用 `browser-sync` 自動重載。
- `make serve HOST=127.0.0.1 PORT=3000`：切換主機與埠號。
- `make help`：查看可用目標與用途。

## 程式風格與命名

- 以現有慣例為準，使用 2 空白縮排、分號、`const`/`let`、箭頭函式為主。
- 元件識別子與常數使用可讀命名（如 `favoriteItems`、`renderResults`）。
- 以行為為中心命名事件處理函式（如 `handle...`、`open...`）。
- 若修改 `public/app.js`，盡量維持既有函式拆分邏輯，避免一次性寫入過大函式。

## 測試與驗證

目前專案無自動化單元測試框架。變更後建議的檢查步驟：

- `make serve` 後在瀏覽器驗證首頁載入、搜尋、分頁、收藏新增/清空、匯出/匯入與分享功能。
- 對 `*.json` 資料檔可用 `python3 -m json.tool` 驗證格式。
- 修改資料欄位時，額外測試包含中英文關鍵字、空結果、非主條件過濾等邊界情境。

## 提交與 PR 規範

- 目前 commit 皆使用 Conventional Commits（如 `feat(app): ...`、`refactor(app): ...`），建議沿用。
- PR 必備：變更摘要、影響範圍、手動驗證結果、回歸風險。
- 若有 UI 變更，附上螢幕截圖或錄影摘要；若為資料更新，請註記版本與來源。

## 自動部署

`.github/workflows/pages.yml` 會在 `main` 分支有 push 時自動部署 GitHub Pages，部署目錄固定為 `public/`。避免提交未經驗證的前端資源變更。
