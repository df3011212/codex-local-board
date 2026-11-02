## 本機語意進度鏡像

有多步工作時，在開始、具意義里程碑、交付時，用目前聊天室已知事實更新共用看板；不要另呼模型、讀取內部思考或解析工具原始日誌。有 canonical `claude-mem work_state_write` 時先維護它，再鏡像摘要；看板不取代該來源。

報告程式（固定共享狀態，不依目前目錄）：
`{{REPORT_COMMAND}}`
結構不確定時先以此命令加 `--example` 讀範例；該模式只輸出格式，可保留命令中的 `--state`，不讀寫狀態，也不要混入 `--json-file` 等回報參數。groups 用 `{id,title}`，tasks 用 `{id,title,group,status,detail,evidence}`，agents 用 `{id,role,assignment,status,current,next}`。status 只用 `not_started/pending/in_progress/source_ready/passed/done/frozen/blocked`；`done/passed/frozen` 必須附 evidence 陣列，例如 `evidence:["已通過檢查"]` 或 `evidence:[{label:"驗證報告",path:"work/result.json"}]`（元素也可用 `{label,url}`），不能填單一字串。
把短 JSON 寫入 UTF-8 檔，再加上 `--json-file <檔案>`，或經 stdin 傳送並加 `--json-stdin`；私人內容不要直接拼接到 shell 命令。根工作使用真實 `CODEX_THREAD_ID`（合法 UUID），必要時明確 `--session-id <該UUID>`；缺少時不要捏造或與別的聊天室合併。欄位寫繁體中文：title、goal、current、next、summary、phase、groups/tasks（明確可驗證關卡）、agents（角色、實際指派與目前工作）。沒有已定義關卡就不產生完成百分比；工具呼叫、停止、程式碼完成不代表驗收完成。只有已確認的結果才標為完成並附簡短 evidence。Token/費用/工時未知就不填，不估算。

根工作首次回報要一次補齊 `title/goal/current/next/summary/phase/groups/tasks/completed/suggestions/agents`，之後按實際進展更新；同時交代已完成及尚缺內容。沒有可核對的關卡或成果時可用空陣列，並在 summary 明確說明待確認，不能捏造 evidence 或完成比例。agents 可列實際主代理及確實指派的子代理；主代理的 assignment、current、next 應反映目前工作，沒有子代理不另造分工。尚未知的內容寫明待確認，避免只寫工具名稱或留讀者猜測。

完成階段工作或交付時，將公開回覆中明確建議的下一步一起寫入 `suggestions:[{id,title,detail}]`（最多8項）；沒有建議用空陣列。`next` 是目前工作的後續安排，suggestions 是尚未採納或開始的建議，不能把建議當使用者核准、完成成果或已開始工作。不要讀取或推測 Codex 輸入框尚未送出的草稿／灰字建議；不得為此另呼模型。

## 專案整體架構與計畫

有開發、安裝或多階段工作時，除了本輪關卡，必須維護可跨工作批次保留的整體架構。先找使用者指定的既有藍圖、README、開發或安裝文件，依實際文件整理階段、模組、驗收項目和依賴；不要改動來源文件或把文件存在視為已完成。若沒有計畫文件，就由正在工作的 Codex 依本次已知需求建立最小可用的開發／安裝計畫，來源標 `generated`、說明待確認範圍；不創造使用者未採納的功能。每個聊天室都要有可辨識的整體目標與架構，未知細節明確標待確認，不能用只有本輪關卡的圖冒稱完整專案範圍。

架構報告使用獨立共享檔，避免本輪任務完成時把整個專案誤判100%：
`{{PLAN_COMMAND}}`
先加 `--example` 看完整格式（可保留 `--state`，不混回報參數）。以短 UTF-8 JSON 搭 `--json-file` 和真實 `--session-id` 寫入完整計畫；之後只更新既有節點時加 `--patch`，payload 為 `{nodes:[{id,status,detail,evidence}]}`。先查看既有計畫並沿用穩定ID；不能每輪清空總架構、刪掉待做範圍或把未重測的舊聲明改成自己的驗收。

計畫包含 `title/goal/summary/source/nodes`；source 用 `{kind:"document"|"generated",label,references:[{label,path或url}]}`。nodes 用 `{id,parent_id,title,kind:"phase"|"module"|"task",status,detail,evidence,depends_on}`，頂層 parent_id 為 null。葉節點使用 task，容器必須有子項；父節點比例由後代的 task 葉計算，不自己填百分比。依賴必須指向已存在節點且不可循環。最多512節點、深度8、64個來源引用；超限明確說明待分拆，不偷偷截斷。完成葉節點一樣需要 evidence 陣列；只做文件盤點就標 pending/source_ready 並說明本輪未重測，不聲稱程式完成。

根代理負責維護總架構；子代理只向根代理回報其分工與證據，不能用父 UUID 擅自覆寫整份計畫。開始工作時建立或讀取計畫，範圍／可驗證里程碑變化時更新，交付時補齊實際成果及建議；不用每次工具呼叫重寫整棵樹。

若父工作明確提供看板父 UUID 與穩定分工 ID，只以子代理模式更新該分工 `{status,assignment,current,next,detail,evidence}`，不能覆寫父工作目標或關卡。根代理 spawn 時把此父 UUID、分工 ID、角色放入任務訊息；回報採明確 `--parent-session-id <父UUID> --agent-id <分工ID> --role <角色>`，不可猜父 ID。身為子代理卻沒有父看板 ID 時暫不另建根聊天室卡片，向父代理回報缺少對應資訊即可。若子代理環境 UUID 仍等於父 UUID，不假稱是另一聊天室。敏感內容、帳密、完整對話不進報告。失敗時保持原工作進度、簡短註記待同步，不聲稱所有聊天室已同步。

補齊既有聊天室時，只從可取得的公開使用者訊息、公開回覆或對話摘要整理；在 summary 與 evidence 註明資料來源、整理時間及未於本輪重測的成果。不可把原對話的完成聲明改寫成自己的驗收通過，也不從工具事件推測百分比。沒有可靠分工資料時明確寫待確認，不捏造子代理。
