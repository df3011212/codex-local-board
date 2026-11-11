# Codex Local Board｜繁體中文本機進度看板

[線上介紹與成果圖](https://df3011212.github.io/codex-local-board/) · [公開互動示範](https://df3011212.github.io/codex-local-board/demo/)

公開互動示範可切換 Codex／ChatGPT 並查看合成的專案架構。自己的對話資料由本機版讀取與保存。

以繁體中文整理每個工作聊天室的**目標、目前工作、下一步、已完成成果、可驗證關卡與分工**。主要入口是使用 Node.js 標準函式庫的本機看板。工作中的 Codex 回報進度，已匯入的 ChatGPT 對話可個別查看與整理。

本倉庫保留原創來源、測試與 Windows 可攜入口，也保留既有 `runtime/` Node.js 及 `vendor/codex-agent-view/` 套件與完整授權。一般使用者解壓縮後直接開啟看板；不需要先裝 Python 或 npm。本專案的公開範例不含私人對話、帳號或特定使用者路徑。

| 介面 | 資料從哪裡來 | 能看見什麼 |
|---|---|---|
| 本專案主要語意看板 | 當前 Codex 模型依指導執行 `agent_report.mjs` 鏡像事實 | 每聊天室的清楚目標／目前／下一步／成果、明確關卡進度與實際分工 |
| 既有對話的整理報告 | Codex 讀取可取得的公開對話摘要後，明確整理並標示來源 | 已知需求、最近進展、已回報成果與後續安排；未重測的成果會註明 |
| ChatGPT 對話工作區 | 桌面 Codex 按需取得索引；使用者可手動編輯或整理一則對話 | 原始對話名稱、返回原對話、手動進度與專案架構 |
| Python v1 相容檢查點 | 你或代理明確執行 `update_state.py` 登記 | 原有多專案檢查點；Node 看板可合併唯讀呈現 |
| 外部 Agent View（進階備選） | 經 Codex 原生載入、授權後收到的全域 hooks | 新工作與子代理的事件、工具活動及許可狀態 |

**Agent View 的事件不會自動轉成這裡的完成百分比。** 工具被呼叫、代理停止或程式碼準備好，都不等於驗收通過。這些介面不提供模型的內部思考；事件監視器也不會重建安裝前未觀測到的事件歷史。

## 快速啟動：主要語意看板

核心報告需要 **Node.js 18 以上**；自動讀取既有對話使用 Node 內建 `node:sqlite`，建議 **24.22.2**，可攜版本已附。無 npm 套件、Python或前端建置依賴，也不需自建資料庫；觀察來源唯讀讀取現有 Codex SQLite 索引。較舊 Node 可顯示語意報告，但該觀察來源會標示不可用。從本來源產生 Windows x64 可攜版本使用下方 `make_portable.py`（僅產生器需要 Python 3.10 以上）。

1. 下載並解壓縮本專案，或使用產生的完整可攜資料夾。
2. 雙擊 `Open-Board.cmd`。使用相對路徑的 `runtime/node.exe`，來源版才會尋找已安裝的 Node。
3. 預設開啟 `http://127.0.0.1:8787`。左側選擇對話，右側直接看目標、目前工作、下一步、成果及分工。
4. 重複開啟會沿用本資料夾的看板；使用 `Close-Board.cmd` 關閉它，狀態保留。

<a id="chatgpt-local"></a>

### 在本機看板切換 Codex 與 ChatGPT

在同一台電腦開啟看板，使用左側 **Codex／ChatGPT** 切換。兩邊各有對話清單，共用右側工作區與專案架構樹。ChatGPT 清單沿用原始名稱，支援搜尋及篩選封存狀態。選取一則對話後，可開啟原對話、更新進度，或建立並編輯該對話的架構。

1. **匯入清單。** 在已登入的桌面 Codex，請它用桌面對話工具 `list_threads`（`mode: "history"`、`source: "chatgpt"`）分頁讀取未封存及已封存的索引。保留要顯示的完整清單，將各筆對話的 `id`、`title`、`archived` 組成 `{ "chats": [...] }`，交給同一份看板的 `chatgpt-pilot.mjs import`。
2. **整理指定對話。** 選擇尚無架構的 ChatGPT 對話，在「專案架構總覽」點 **用 Codex 自動整理**。桌面 Codex 會開啟已填好提示的新對話，按 **送出** 後才會讀取指定對話已送出的訊息。
3. **查看結果。** 有明確專案目標及可驗證關卡才會建立架構，計畫與新開的 Codex 整理對話使用原 ChatGPT 對話名稱。資料不足時保留空白，已有架構可手動編輯。切回看板即可查看整理結果。

已有完整索引 JSON 時，可在看板資料夾執行以下命令。`--file` 接收 UTF-8 JSON，`--stdin` 可改由標準輸入傳入同樣資料。

```powershell
.\runtime\node.exe .\chatgpt-pilot.mjs import --file "C:\path\to\chatgpt-index.json"
```

CLI 只匯入你提供的索引，每次以該份清單為準。重新匯入時，對話 ID 相同的進度與架構會保留。索引與手動進度存放在 `.runtime/chatgpt-pilot.json`，架構保存在 `.runtime/chatgpt-plans/`，整理結果只保存必要的摘要、關卡和證據。更新這份索引不會逐則閱讀對話；架構整理目前由使用者逐則發起，需要桌面 Codex 提供對話存取功能。ChatGPT 清單與寫入功能僅在本機電腦的看板可用。

<a id="phone-private-access"></a>

### 手機查看：Tailscale 私人 HTTPS 入口

手機可在同一個 Wi-Fi 或外出使用行動網路查看電腦上的看板。電腦與手機都要安裝 [Tailscale](https://tailscale.com/download)，登入同一帳號所屬的私人網路（tailnet），並保持 Tailscale 連線；電腦必須開機、保持喚醒，且本機看板持續運行。入口只限 tailnet 存取規則允許的裝置／成員，範圍可能包含其他成員；請使用自己的私人 tailnet。本工具不代改存取規則（ACL）。

1. 在 Windows 安裝 Tailscale，依原生視窗完成系統權限與帳號登入；在手機安裝 Tailscale 並登入相同帳號。本專案不代替你登入或接受授權。
2. 在電腦雙擊 `Open-Board.cmd`，先確認本機看板正常。
3. 雙擊 `Open-Phone-Board.cmd`。若尚未登入或尚未啟用 HTTPS，依顯示的指引，由你本人完成 Tailscale 的原生設定與同意，再重開此入口。HTTPS 憑證會將裝置名稱與 tailnet DNS 名稱記錄於公開憑證紀錄，核准前可先檢查名稱。
4. 啟用成功後，在已連上 Tailscale 的手機瀏覽器輸入視窗顯示的私人 HTTPS 網址（預設連接埠 `8443`）。電腦上的 `127.0.0.1:8787` 不能直接當作手機網址。

| Windows 入口 | 功能 |
|---|---|
| `Open-Phone-Board.cmd` | 檢查本機看板，啟用本工具專用的私人 HTTPS 入口 |
| `Check-Phone-Board.cmd` | 查看本機看板、私人橋接與 Tailscale 狀態；不改連線設定 |
| `Close-Phone-Board.cmd` | 停用本工具持有的手機入口；本機看板繼續運行 |

重開機後，先開啟本機看板，再雙擊 `Open-Phone-Board.cmd` 恢復本機橋接。Tailscale 的背景 Serve 設定可能仍在，但電腦、主看板或橋接未運行時，手機仍無法取得資料。安裝與電腦端檢查成功後，仍需由你在手機實際開啟網址確認連線。

停用時若 Tailscale 離線或無法查核，只會關閉可驗證為本工具持有的本機橋接，保留記錄並提示尚未完成。恢復 Tailscale 連線後，再執行一次 `Close-Phone-Board.cmd` 完成 Serve 清理，不會清除其他服務。

本機主服務仍只監聽 `127.0.0.1:8787`；手機入口透過 Tailscale Serve 轉送至本工具的 `127.0.0.1:8788` 唯讀橋接。只提供固定看板讀取路由，不提供寫入、控制 Codex、啟動同步或進階 Agent View 的授權入口。不啟用公開的 Funnel，不修改防火牆，也不清除其他 Serve 設定；預設專用連接埠已被占用時會停止並說明。

手機開啟與一般刷新不另外呼叫 AI、不使用模型額度；它顯示電腦已取得的資料。需要補齊舊聊天室時，仍由電腦明確執行下節的 `Sync-All-Chats.cmd`，該操作可能使用 Codex 額度。私人網址、`.runtime/` 與執行中的狀態檔不要貼到 GitHub。**GitHub Pages 是公開示範，並不是你自己的私人看板入口。**

來源版可用 Node.js 18 以上執行 `node private-access.mjs status --root .`；可攜版使用內附 Node。進階連接埠可由 CLI 的 `--board-port`、`--bridge-port`、`--https-port` 指定；查詢、啟用與停用必須使用同一組設定。已安裝的 Tailscale 找不到時，可用 `--tailscale-bin` 指定既有 `tailscale.exe` 的絕對路徑；此入口不自行安裝 Tailscale。

官方參考：[Windows 安裝與登入](https://tailscale.com/docs/install/windows)、[私人 Serve](https://tailscale.com/docs/features/tailscale-serve)、[HTTPS 與憑證名稱](https://tailscale.com/docs/how-to/set-up-https-certificates)。

### 首次補齊既有 Codex 聊天室

開啟主要看板後，雙擊 `Sync-All-Chats.cmd`。它會明確啟動一次本機 Codex，讀取可取得的公開對話摘要，整理各聊天室的目標、目前工作、下一步、已回報成果及可核對分工，寫入私人 `conversation-summaries.json`。

這個操作使用本機已登入 Codex 的可用額度；它不是免費的規則推斷，也不會在每次頁面刷新時重新呼叫模型。請依視窗中的結果確認同步是否完成；額度、登入或來源資料不可用時，應保留待同步狀態，不能當成驗收成功。

只檢查可同步數量與讀取限制，不啟動模型：

```powershell
.\runtime\node.exe .\sync-all.mjs sync --dry-run
```

同步器先使用 `--codex-bin` 指定的 CLI，再查看 `CODEX_LOCAL_BOARD_CODEX_BIN` 或 PATH 上的 `codex`。找不到時會停止，不自動安裝或改動設定；可先在一般終端機確認 `codex --version`。它沿用已登入的 CLI 與既有模型設定，不跳過原生信任要求。單次執行預設最多等待 **600 秒（10 分鐘）**，可用 `--timeout-seconds` 指定 1–600 秒；所有目標通過格式檢查後才合併整理結果，失敗或逾時會保留原檔。視窗會顯示目前階段及已等待時間，不從模型內部事件推測百分比。逾時的那次執行可能已使用額度；程式不會自動重試，請勿反覆開啟同步視窗。

一次最多整理 50 個尚未有完整直接回報的原生對話，模型輸入總量最多 512 KiB，每個對話最多 24 KiB。`--dry-run` 與完成結果會列出數量及 `omitted_capacity`；超出容量的對話仍未同步，不能因這批完成就宣稱全部聊天室已同步。

每次執行的輸入、暫存整理與日誌放在 `.runtime/sync-runs/`。即使輸入經過遮蔽，仍可能包含私人工作內容，請勿公開這個資料夾或 `conversation-summaries.json`。`export --output <絕對路徑>` 只匯出可用上下文，不呼叫模型；目標必須是 `--root` 內尚不存在的新 JSON，不能位於 Codex 使用者目錄，也不能覆寫既有檔案。匯出檔應視為私人資料。

同步中的第二次啟動會回報忙碌。若上次曾被手動中斷而留下 `.runtime/sync-all.lock`，先確認沒有任何同步工作仍在執行，再備份並只移除這個鎖檔後重試；不要在同步執行中移除鎖，也不要清除整個 `.runtime`。一般模型失敗或正常逾時會自行釋放鎖。

看板按下列優先順序顯示同一真實對話 UUID：

1. 工作中的 Codex 寫入 `state-v2.json` 的結構化回報。
2. 這次明確同步寫入 `conversation-summaries.json` 的整理報告。
3. 只有公開文字的唯讀觀察摘要。

整理報告會保留來源及未重測註記，不代表程式替每個其他專案重新執行測試。之後讓工作中的 Codex 載入下節全域指導，便能在工作開始、里程碑及交付時持續鏡像新進度。需要重新整理既有聊天室時，再明確執行一次同步即可。

可在終端機以前景方式執行（`Ctrl+C` 結束）：

```powershell
node board-node.mjs serve --root . --state ./state-v2.json --summary-state ./conversation-summaries.json --legacy-state ./state.json --config ./config.json --port 8787 --open
```

Codex 語意資料存放 `state-v2.json`，與 Python v1 的 `state.json` 分開。頁面每五秒重讀 Codex 進度。ChatGPT 卡片及架構經由本機同來源路由保存。

對話名稱沿用 Codex 原始字樣，從本機 `CODEX_HOME/session_index.jsonl` 的最新 `thread_name` 唯讀取得；在 Codex 重新命名後，看板後續刷新會跟著更新，不自行改寫儲存中的語意報告。關閉觀察來源時也不讀這份名稱索引。

左側每個對話只顯示一行原名，過長時用省略號呈現，完整名稱保留在提示文字與搜尋內容。當原生名稱索引可用、且至少有一個可對應名稱時，主清單只列出可對應 Codex 名稱的對話；尚無原生名稱的報告與測試任務收在預設折疊的「其他同步任務」，不混入主清單，也不刪除資料。沒有可用原生名稱時，仍可選擇已同步的工作報告。重新讀取資料會保留目前選擇、搜尋、焦點及折疊狀態。

桌面寬度超過 920px 時，頁面下滑仍會保留左側對話欄；對話過多時在左欄內獨立捲動。較窄視窗維持流式版面，避免固定欄遮住主要工作內容。

### 如何分辨仍在執行與等待下一步

對話列表、目前選取的工作與「目前正在做」會顯示獨立的執行狀態。收到明確的執行中訊號時出現轉圈；收到停止訊號時顯示「目前未執行」；來源不可用、尚未觀測到、等待使用者或訊號過期時顯示「未取得執行狀態」。取得狀態暫時失敗時會停止顯示舊的轉圈，保留最後工作摘要並等待重試。

執行訊號來自**已經運行的 Codex Agent View** 的唯讀狀態 API，只取目前回合的明確狀態與時間；不解析原始工具日誌、不讀取內部思考，也不使用「關卡進行中」或回報時間推測 Codex 正在跑。需要既有 Agent View 外掛的 hooks 已依 Codex 原生流程載入並收到事件；本看板不會為了轉圈自動安裝外掛、啟動 Codex 或更改信任設定。沒有這個選配來源時，其他工作進度仍正常顯示，執行狀態保持未知。此來源不另呼模型，不使用 Codex 額度；頁面仍依設定的輪詢週期更新，與 Codex 視窗可能有短暫延遲。

「進行中」關卡沒有細部百分比時，使用不定量進度條，**不隨時間自動增加百分比**；來源確認該對話執行中時才播放動畫。上方數字仍是已驗收關卡的完成比例，例如四個關卡尚未完成時為 0 / 4，並不表示程式卡住。偏好減少動態的使用者會看到靜態狀態與文字。

「最後摘要較早」表示工作摘要已超過 10 分鐘，並非模型排隊倒數。頁面每次成功讀取的時間另列於「頁面讀取」，摘要則等待原對話的 Codex 在有意義的里程碑回報。此時不必執行 `Sync-All-Chats.cmd` 去更新仍在工作的聊天室：完整直接回報會優先保留，不由舊對話整理覆寫。

### 查看回報格式

在專案資料夾執行：

```powershell
.\runtime\node.exe .\agent_report.mjs --state "$PWD\state-v2.json" --example
```

來源版若沒有內附 Node，將 `.\runtime\node.exe` 換成 `node`。`--example` 可單獨使用，或搭配固定報告命令中的 `--state`；兩者只輸出合成格式範例，不讀寫狀態檔，也不要求對話 UUID。不要同時加上 `--json-file`、`--json-stdin` 或其他實際回報參數。

正式回報由工作中的 Codex 寫出短 UTF-8 JSON，再執行固定的共享狀態命令加上 `--json-file <檔案>`，或透過 stdin 加上 `--json-stdin`。首次根報告應補齊 `title`、`goal`、`current`、`next`、`summary`、`phase`、`groups`、`tasks`、`completed`、`agents`，同時交代已完成與尚缺內容。沒有可核對關卡或成果時使用空陣列並說明待確認；分工只列真實主代理及確實指派的子代理。完成項目的 `evidence` 必須是陣列，不接受把原始日誌當成報告。

### 讓新工作自動鏡像報告

Codex 在新工作開始時載入 `CODEX_HOME`（預設家目錄 `.codex`）的全域指導（[官方提示指南](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)）。本節的語意鏡像由**當前模型已理解工作後，依短指導使用 reporter 登記摘要**，不另呼 LLM，也不解析內部思考或用工具日誌推測進度。下節的只讀觀察來源則自動列出既有普通對話。既有 canonical `claude-mem work_state_write` 保持主要來源；有該工具時先更新它，再鏡像看板。

先檢查／預覽，確認後安裝（可攜版本將下列 `node` 改成 `.\runtime\node.exe`）：

```powershell
node install-agent-guidance.mjs audit
node install-agent-guidance.mjs install --render
node install-agent-guidance.mjs install --apply
```

安裝器只加入自己的 managed block，保留所有既有文字與章節；每次實際變更前將原始 bytes 備份到 `CODEX_HOME/.codex-local-board-guidance-backups`，支援 UTF-8 BOM／CRLF。存在 `AGENTS.override.md` 時處理優先生效的該檔，不會把指導加到被遮蔽的 `AGENTS.md`。未知／重複標記、連結檔、同時編輯或鎖衝突會拒絕，不自動覆寫使用者內容。請勿在安裝時同時手動編輯全域檔案；備份可能含私人指導，不要上傳。

只移除本專案指導，保留其他文字及狀態：

```powershell
node install-agent-guidance.mjs uninstall
node install-agent-guidance.mjs uninstall --apply
```

`install`／`uninstall` 未加 `--apply` 只預覽。可用 `--codex-home` 指定測試用 Codex 目錄、`--board-root` 指定長期保留的本專案資料夾、`--node` 指定固定 Node 路徑；報告命令會固定共享狀態的絕對位置，避免每個工作目錄各存一份。移動看板資料夾後請重新預覽／安裝，更新指導中的位置。

生效範圍是**之後載入這份全域指導的工作**。安裝器不強制重啟、不更改 hooks／信任；已執行中的舊對話不保證熱載入。需要補齊既有對話時，可請 Codex 透過可用的對話讀取工具整理公開摘要，或在該對話載入指導後回報已知狀態。整理報告必須註明來源；原對話聲稱已完成的成果，不能冒稱已在本輪重新測試。

根工作使用真實 `CODEX_THREAD_ID` UUID；缺少就等待明確 ID，不隨機冒充聊天室。spawn 子代理時要在任務訊息帶父工作 UUID、穩定分工 ID 與角色；子代理只更新該分工，不覆寫父目標或關卡。工具停止不等於交付完成，沒有已定義關卡不顯示假百分比；費用／Token／工時未知就不填。開始多步工作、有意義的里程碑和最終交付各更新一次即可，不用每次工具呼叫都製造事件。

## 每個聊天室會自動更新嗎？

**畫面每五秒自動讀取，工作內容由該聊天室的 Codex 明確回報。** 已載入全域指導的工作會在開始、里程碑和交付時更新目標、目前工作、下一步、成果與建議；不需要每次執行 `Sync-All-Chats.cmd`。只有想補齊舊對話、或原對話尚未回報時才需要明確整理。舊工作不保證熱載入新的全域指導；可在原對話繼續工作時請 Codex 依看板指導更新。單純開著網頁不會另叫 AI 理解整段對話，也不會讓未採納的建議自己開始執行。

### 完成之後的下一步建議

`next` 顯示目前工作的後續安排，`suggestions:[{id,title,detail}]` 顯示 Codex **公開回覆裡明確提出**、尚未開始的後續建議。每次最多八項，可複製文字帶回原對話；看板不會代替使用者發訊息、批准範圍或執行建議。沒有明確回報就顯示尚無建議，不從灰色輸入提示、未送出草稿、內部思考或工具日誌重建建議。

### 專案架構總覽與跨階段進度

每個對話可有獨立的**專案整體架構**：專案目標 → 階段 → 模組 → 驗收任務，並列出依賴、來源文件與已完成的任務葉比例。支援收合、搜尋與只看未完成。「目前工作關卡」和「全專案驗收」分開計算；單次工作 100% 不會把仍有後續階段的整個專案變成 100%。

有藍圖、README、開發或安裝文件時，由工作的 Codex 依指定文件建立架構並附引用；不同版本的來源、技術選擇與階段編號要在摘要保留差異。沒有文件時，由同一個工作 Codex 依已知需求建立 `generated` 初始計畫，標示待確認範圍，不額外啟動一個模型。之後沿用穩定節點 ID 更新進度，不在每一輪完成時清掉原來的待做項目。沒有完整計畫的舊對話只能先顯示「已回報部分關卡」，全專案比例保持未知；這種有限資料不冒稱完整開發計畫。

#### 從架構項目接續工作：複製給 Codex

1. 在左側選擇對話，找到「專案架構總覽」，展開要處理的驗收項目、模組／分組或階段。
2. 按該項目的「複製給 Codex」。單項會複製該驗收項目；模組或階段會包含**整個所選分支的全部子項**。收合、搜尋及「只看未完成驗收項目」都不會截斷交接範圍。
3. 切回 Codex 中**同名的原對話**，貼上並檢查範圍、來源及依賴。可先編輯文字，確認後再按傳送，Codex 才會接續工作。

交接文字包含對話與專案目標、節點 ID、所選階層、各項狀態與說明、來源引用、前置依賴及原回報證據。已回報完成的項目仍保留供核對，不表示要無條件重做；範圍外依賴會標明「先核對，不自動擴大工作」。若只有部分關卡，文字會明示完整範圍仍待補齊。這是點選當下的看板快照，複製本身沒有重新驗收。

瀏覽器不允許剪貼簿存取時，該節點下方會出現唯讀交接文字，選取後手動複製即可。一般輪詢會保留目前畫面與手動複製區；切換對話或計畫資料更新後，請重新選擇項目，以取得新的快照。

**複製不等於採納或傳送，也不會修改進度、執行任務或額外呼叫模型。** 本版網頁沒有串接原生對話傳送介面，不會將文字填進原聊天室或代按傳送；貼回 Codex 後的執行才使用該對話的模型與額度。OpenAI 的[官方桌面命令文件](https://learn.chatgpt.com/docs/app/commands#deep-links)將開啟既有聊天室與新聊天室預填文字分開說明，這裡採用可檢閱的複製貼回流程。

公開互動示範也可試用此按鈕，但複製文字會明示為自創示範，並非你的真實待辦。本機版的交接內容可能帶有所屬專案的來源路徑，請貼回對應的原對話；公開分享前先檢查內容。

計畫只存本機私人 `project-plans.json`，不混入即時工作回報或 GitHub。回報程式為 `plan_report.mjs`；它接受已整理好的資料，不會自動掃描任意工作目錄。先看不讀寫資料的範例：

```powershell
.\runtime\node.exe .\plan_report.mjs --state 'C:\MyBoard\project-plans.json' --example
```

完整計畫 JSON 包含 `title/goal/summary/source/nodes`，source 為 `{kind:"document"|"generated",label,references:[{label,path或url}]}`。節點包含 `id,parent_id,title,kind,status,detail,evidence,depends_on`；`kind` 為 `phase/module/task`，頂層 parent_id 為 null。寫入時以 `--state <獨立JSON絕對路徑> --session-id <原對話真UUID> --json-file <自己整理的JSON>` 執行。只更新既有節點時加 `--patch`，payload 使用 `{nodes:[{id,status,detail,evidence}]}`，不會更動其他聊天室或刪除整體範圍。

上限為每計畫 512 個節點、深度 8、64 個來源引用，單次回報 512 KiB、儲存 8 MiB／100 個對話；超限會拒絕而不截斷。父節點比例只從後代 task 葉的 `done/passed/frozen` 與非空證據計算，不能靠父節點自己標完成灌入百分比；沒有任務葉時不顯示比例。文件盤點、來源候選、草案與尚未重測的交付聲明必須說清楚，不能改寫成本輪驗收通過。

### 已存在對話的唯讀來源

主要 Node 看板預設還會嘗試從本機 Codex 索引列出可確認的使用者根對話，只讀取公開使用者訊息與明確公開的助理訊息作為簡短來源。這是沒有額外 LLM 的有限資料整理，**不是把工具日誌猜成完成進度，也不是理解全部歷史**。子代理與未知來源不冒充另一個使用者聊天室；推理／analysis、系統指導、工具輸入輸出不會進入這條來源。

此類列會標示「已讀取公開對話・待關卡同步」。只有公開文字時，關卡顯示待建立、百分比保持空值，不從結束事件推測完成；相同真 UUID 的模型結構化報告優先，才能提供更清楚的目標、下一步與已驗證成果。

讀取 SQLite 索引需要支援 `node:sqlite` 的 Node；可攜版本的 **24.22.2** 已具備。較舊 Node 仍可使用結構化語意報告；若觀察來源不可用，會顯示診斷，不聲稱已列出所有對話。安裝位置、版本、尚未同步或超出讀取限制都可能使某些對話暫不可用。

可完全關閉此來源，或明確指定本機 Codex 目錄：

```powershell
.\Open-Board.cmd --no-observe
.\Open-Board.cmd --codex-home "你的 Codex 目錄"
```

`--no-observe` 同時關閉原生名稱、公開對話與執行狀態的觀察；已登記的工作報告仍可讀取。

觀測模式或目錄與已執行服務不同時，先用 `Close-Board.cmd` 正常關閉，再重新開啟；不會偷偷沿用不同設定。這個只讀來源和全域語意指導分開，後者的載入仍遵守上面的新工作／舊對話限制。不要將執行中的私人狀態檔放進公開 GitHub。

## Python v1 檢查點相容方式

只有這個舊版相容入口需要 Python **3.10 以上**；主要 Node 看板不需要 Python。此入口不用 pip、Node.js 或自建資料庫，Windows 腳本支援 Windows PowerShell 5.1。

1. 下載並解壓縮本專案到你自己的資料夾。
2. Windows 雙擊 `Start-Board.cmd`。
3. 預設瀏覽器開啟 `http://127.0.0.1:8787`。初次啟動只建立缺少的 `state.json`、`config.json`；不覆寫既有內容。
4. 使用 `Stop-Board.cmd` 關閉本資料夾啟動的看板。狀態檔保留。

兩個入口預設都使用 8787，不要同時占用同一連接埠。測試舊版時可使用另一份資料夾與下方 8788 範例；避免把舊版自訂設定套到主要 Node 看板。

指定其他連接埠或不開瀏覽器：

```powershell
.\Start-Board.ps1 -Port 8788 -NoBrowser
.\Stop-Board.ps1
```

macOS、Linux 或偏好手動執行時：

```sh
python update_state.py init
python server.py --port 8787
```

部分系統使用 `python3`。前景執行以 `Ctrl+C` 結束。`python server.py --check` 只驗證檔案、不開服務。

Start／Stop 只管理本資料夾的程序，核對 PID、啟動時間、Python 執行檔和完整命令列參數。重複啟動會沿用同一程序；遇到其他服務占用連接埠會失敗，不會關掉別人的程序。Windows 使用排他 socket，避免不同程序共用相同連接埠。

## Python v1：登記真實檢查點

範例一開始全部為待完成，會顯示「範例資料」。真正更新後移除此標記。以下範例需由你核對事實後執行；指令本身不會替你做驗收。

```sh
python update_state.py set-task --project website-demo --id requirements --status done --detail "需求與驗收條件已核對"
python update_state.py set-task --project website-demo --id implementation --status source_ready --detail "實作已備妥，測試尚未完成"
python update_state.py event --project website-demo --text "開始驗證輸入與輸出"
python update_state.py set-agent --project website-demo --id reviewer --role "驗證協作者" --status in_progress --detail "正在執行已列明的檢查"
```

新增專案、關卡：

```sh
python update_state.py add-project --id my-project --title "我的專案" --summary "由明確驗收關卡追蹤"
python update_state.py add-task --project my-project --id verify --group delivery --title "輸入與輸出驗收"
python update_state.py set-project --id my-project --phase "驗收中" --summary "依實際結果更新"
```

`--state`、`--config` 放在子命令之前，可使用其他本機檔案：

```sh
python update_state.py --state other-state.json --config other-config.json init
python server.py --state other-state.json --config other-config.json --port 8788
```

同一檔案的 CLI 寫入以作業系統鎖序列化，再原子替換 JSON，減少多個協作者互相覆蓋。未知 ID、非法狀態或超過限制的更新會拒絕。若手動編輯 JSON，請自行協調；編輯器不會自動遵守 CLI 的鎖。

## 進度與介面設定

`config.json` 可調標題、副標、輪詢秒數，以及分工／事件區是否顯示；預設每 **5 秒**重讀資料，範圍為 1–60 秒。Node v2 工作回報位於 `state-v2.json`，一次性整理位於 `conversation-summaries.json`，Python v1 相容資料才位於 `state.json`，不要混用結構。`server.py --check` 只檢查 Python v1 資料，不是 Node v2 的驗證命令。

新版只將 `done`、`passed`、`frozen` 且附有證據的關卡計入完成。`source_ready`、`in_progress`、`blocked` 都不計入。Python v1 的資料設定層雖可接受其他完成狀態，不能將它的設定直接套到 Node v2；新版會拒絕把 `source_ready` 加入 `complete_statuses`。

比例為 **完成關卡數 ÷ 全部關卡數**，各關等重，向下取整；199／200 仍是 99%，全部完成才顯示 100%。無關卡時顯示「尚無關卡」。這不是工時估算、工作量加權或交付時間預測。

資料暫時無法讀取時保留上一次畫面，並清楚顯示讀取失敗，避免把舊資料當作最新進度。所有文字透過文字節點呈現，不把狀態欄位當成 HTML。

## 選配：全域代理事件監看

上游 [Codex Agent View](https://github.com/JunhoYoon95/codex-agent-view) 是獨立的 Apache-2.0 專案。本倉庫既有的 `vendor/codex-agent-view/` 保留完整套件、`LICENSE` 與 `NOTICE`，其中兩個公開 UI 檔套用本專案繁中補丁；它的授權維持獨立，不改為本專案的 MIT。主要語意看板不依賴此進階事件介面。

需求為 Node.js **18 以上**、npm，以及支援 plugins／hooks 且可在終端機呼叫的 Codex CLI。只有使用本機檢查點看板時，不需要這些額外工具。

```powershell
.\Install-AgentView.ps1
```

腳本固定使用官方公開版本 `0.5.6`：

```sh
npm install --global --ignore-scripts codex-agent-view@0.5.6
codex-agent-view install
codex-agent-view doctor --json
```

安裝前將既有 Codex `config.toml` 備份到使用者私人 `%LOCALAPPDATA%\CodexLocalBoard\private-config-backups`，不放進本專案。備份可能含私人設定，請勿公開。腳本保留既有設定與其他外掛，使用 npm 現有的全域 prefix；不要求系統管理員權限、不默默改 prefix，不安裝或升級 Codex，也不強制重開。

若缺 Node／npm／Codex，腳本會指出缺少的項目後停止。若 npm 的現有 prefix 需要你沒有的權限，請先安排自己的 Node／npm 使用者安裝。CLI 不在 PATH 時，會另查 `npm prefix --global` 的官方 shim。

### 原生 hooks 檢閱與自動登記

依 Codex 原生 **Plugins／Hooks Review／Trust** 提示檢閱。安裝腳本不寫入信任資料，也不自動點選授權；`doctor` 若回報 trust 為 `unknown`，不能解讀為已完成原生信任。

完成原生載入與授權後，全域外掛接收這九類事件：

`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`Stop`、`SubagentStart`、`SubagentStop`、`PreToolUse`、`PostToolUse`、`PermissionRequest`。

此設定適用於同一使用者 Codex 環境載入外掛後的新工作，不限安裝時的那一個對話。收到新工作事件會自動登記到共用監視器；服務未啟動時，上游 hook 會啟動／沿用同一個本機監視器，**不必每個對話另開一台服務**。外掛的原生載入時機仍以你的 Codex 提示為準；必要時由你選擇適當時機重開 Codex、開新任務。

這不是掃描側欄所有舊聊天，沒有安裝前歷史回放，也不猜測模糊的工作指派。上游事件保存在記憶體，有容量限制，不應當作永久稽核紀錄。安裝成功或九個 hook 已登記，也不代表已驗證每一類事件都在你的環境實際觸發。

### 開啟共用代理看板

雙擊 `Open-All-Agents.cmd`，或在一個獨立的 Codex 查看任務使用 `@codex-agent-view`。包裝腳本只在子程序暫時清空 `CODEX_THREAD_ID`，呼叫無參數的官方 `codex-agent-view open`，讓共用頁面包含所有已觀測工作；不偽造工作 ID、不修改全域環境。

官方命令會把短效私人查看授權直接交給系統預設瀏覽器。不要複製或公開帶授權的 URL。授權不是永久有效；超時時重新執行開啟命令。不要把進階 `start` 命令印出的私人目標當成永久捷徑。

### 產生主要看板的可攜資料夾（Windows x64）

若一般桌面啟動程式找不到 Codex 內工具看得見的 AppData 檔案，先在**一般 Windows 終端機**檢查安裝位置。不同執行環境的檔案可視性可能不同；僅有這個症狀不能確定是 MSIX 虛擬化。

另提供不依賴 npm shim、PATH 或 AppData 啟動腳本的入口產生器：

```powershell
python make_portable.py --output "$HOME\Desktop\Codex-Local-Board-Launcher"
```

需要 Python 3.10 以上及網路，產生器本身不需要已安裝 Node。預設只下載官方 Node.js **24.22.2 Windows x64 ZIP**，核對固定 SHA-256，搭配本專案的語意看板、reporter、指導安裝器與繁中網頁，建立全新資料夾；既有資料夾會拒絕覆寫。

新資料夾包含 `runtime/node.exe`、Node 完整 `LICENSE`、本專案 MIT 來源、繁中使用說明、範例與逐檔雜湊。本倉庫已保留一份既有 Windows 可攜內容；產生器提供從固定官方來源重建新資料夾的方式，不會複製執行中的私人狀態。

雙擊新資料夾內 `Open-Board.cmd`，直接使用相對路徑的 Node 開啟主要語意看板；`Close-Board.cmd` 只關閉已核對健康身分、PID、根目錄指紋與執行個體 ID 的本資料夾服務，不會根據任意 PID 檔關閉其他服務。請保留整個資料夾；產生器不自動改動桌面其他捷徑。

主要看板**不需要 Agent View 外掛**。在長期保留的新資料夾，依上方步驟預覽並安裝全域語意指導，讓之後載入指導的 Codex 工作鏡像報告。產生器本身不安裝指導、不註冊外掛、不改信任、不開服務／瀏覽器，也不複製私人設定、token 或事件。

若另外需要進階工具活動介面，可加選外部 Agent View：

```powershell
python make_portable.py --output "$HOME\Desktop\Codex-Local-Board-With-Events" --with-agent-view
```

這才額外下載 npm **Agent View 0.5.6 TGZ**、核對固定 SHA-512 及完整 23 個檔名，保留 Apache `LICENSE`／`NOTICE`。預設只翻譯兩個公開 UI 檔，`--english` 保留該進階介面的原始語言。產生的 `Open-All-Agents.cmd` 使用相對 Node／官方 CLI 開進階介面，暫時清空子程序 `CODEX_THREAD_ID`，不列印私人授權網址；它仍須事先安裝官方外掛並完成原生 hooks 檢閱，仍沿用家目錄 `.codex-agent-view` 或既有 `CODEX_AGENT_VIEW_RUNTIME_DIR`，不因可攜入口繞過安裝或信任。

主要入口回報失敗時先看 `.runtime/node-server-error.log`；鎖檔衝突時先確認沒有另一個啟停操作，不要刪除仍在使用的鎖。只有加選 Agent View 時，其唯讀診斷命令是（輸出可能含本機路徑，請自行檢查再分享）：

```powershell
.\runtime\node.exe .\vendor\codex-agent-view\bin\codex-agent-view.mjs doctor --json
```

下載來源及版本依據：[Node.js 官方雜湊清單](https://nodejs.org/dist/v24.22.2/SHASUMS256.txt)、[npm 官方套件資訊](https://registry.npmjs.org/codex-agent-view/0.5.6)。雜湊不符或上游版本不同時會拒絕，請勿關閉驗證繼續安裝。

### Agent View 繁體中文介面

另附 `agentview_zh_tw.py` 與 `agentview.zh-TW.json`。安裝腳本在 Python 3.10 以上可用時，最後嘗試套用繁中補丁；缺 Python 不影響 Agent View 原本的安裝，可稍後手動執行：

```sh
python agentview_zh_tw.py
python agentview_zh_tw.py --apply
```

第一行只檢查，第二行才寫入。非預設安裝位置可用 `--root` 指定已安裝的 Agent View 套件根目錄，可重複指定。

補丁只接受 **0.5.6 的精確原始公開資源雜湊**，只改 `public/app.js`、`public/index.html`，完整核對 160 個翻譯鍵與插值欄位，將繁中設為新語言預設；使用獨立的語言設定鍵，避免舊英文偏好蓋過新預設。原始 UI 備份留在私人 LocalAppData，重複套用可安全辨識。

不相符的版本、未知修改或錯誤備份會拒絕；升級上游後不保證補丁仍適用。此補丁不修改 hooks、授權、事件發送或狀態輪詢，不需為修改公開 UI 強制重啟監視器。補丁只翻譯介面，工作名稱／工具輸出等原始內容仍依來源顯示。上游 Apache-2.0 授權不因本補丁而改變。

## 本機範圍與資料限制

伺服器只綁定 `127.0.0.1`，僅接受符合實際連接埠的 localhost／127.0.0.1 Host。看板使用固定讀取路由，ChatGPT 卡片及架構另有固定的本機同來源 `PUT` 路由。Tailscale 手機橋接只轉送指定的唯讀路由。同一台電腦上的其他程序仍可能讀取本機資料，請將密碼或機密存放在適合的工具。

Node v2 每份語意狀態最多 8 MiB、500 個聊天室；單次報告最多 64 KiB，每聊天室最多 200 個關卡／32 個分工／30 筆事件／12 個群組，證據及文字另有限長。一次性整理另有上述 50 對話與輸入容量限制。Python v1 相容狀態最多 256 KiB、20 個專案，每專案 200 個關卡／32 個分工／30 筆事件。過大、非法 JSON 或結構不符時拒絕，不偷偷截斷關卡；各聊天室事件只保留最近三十筆。

`.gitignore` 排除執行中的 `state-v2.json`、`conversation-summaries.json`、`state.json`、`config.json`、`.runtime`、鎖檔及測試暫存。公開範例不含任何實際工作資料；請自行檢查要提交的其他檔案。

## 驗證

```sh
python -m unittest discover -s tests -v
node --check web/app.js
node tests/test_dom.js
node tests/test_guidance.mjs
node tests/test_launcher.mjs
node --test tests/board-node.test.mjs
node --test tests/codex-titles.test.mjs
node --test tests/codex-execution.test.mjs
node --test tests/execution-merge.test.mjs
node --test tests/project-plan.test.mjs
node --test tests/plan-integration.test.mjs
node --test tests/test_observer.mjs
node --test tests/summary-merge.test.mjs
node --test tests/sync-all.test.mjs
node --test tests/private-access.test.mjs
node --test tests/chatgpt-pilot.test.mjs tests/chatgpt-plan.test.mjs
```

Windows PowerShell 5.1 的解析及真實程序啟停測試：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\Test-Scripts.ps1 -SmokeLifecycle
```

測試涵蓋固定 HTTP 路徑、Host、HTTP 方法、大小與結構限制、失敗不覆寫、並行更新不遺失、事件上限、初始化保留、百分比、雙專案 DOM、安全文字與響應式版面結構，以及含空格路徑、重複啟動、假 PID／其他服務拒絕及正確關閉。繁中補丁以自製合成介面結構測試版本拒絕、插值鍵、預覽及重複套用，不攜帶上游完整 JS。

可攜入口測試使用自製 archive，核對雜湊失敗、下載跳轉拒絕、tar 路徑穿越／連結拒絕、精確檔名、相對入口、授權檔保留與既有輸出不覆寫；不會替測試安裝外掛或打開瀏覽器。

私人手機入口測試使用合成 Tailscale 設定與本機測試服務，核對固定唯讀路由、Host／Origin、Funnel 拒絕、上游實例綁定與保留其他 Serve 設定。這些測試不代替手機的實際 Tailscale 登入與 HTTPS 連線驗收。

DOM 測試不是瀏覽器像素驗收；安裝腳本的靜態檢查也不等於所有機器上的 hooks 已實際運作。

## 授權

本專案原創看板、腳本與翻譯補丁採 [MIT](LICENSE)。內附 Node.js 的完整授權位於 [`runtime/LICENSE`](runtime/LICENSE)，包含其使用的第三方元件條款。獨立依賴 Codex Agent View 由其作者提供，採 [Apache-2.0](vendor/codex-agent-view/LICENSE)，並保留 [`NOTICE`](vendor/codex-agent-view/NOTICE)。本專案不是 OpenAI、Node.js 或 Agent View 上游官方發行版本。
