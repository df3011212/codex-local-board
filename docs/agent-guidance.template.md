## 本機語意進度鏡像

有多步工作時，在開始、具意義里程碑、交付時，用目前聊天室已知事實更新共用看板；不要另呼模型、讀取內部思考或解析工具原始日誌。有 canonical `claude-mem work_state_write` 時先維護它，再鏡像摘要；看板不取代該來源。

報告程式（固定共享狀態，不依目前目錄）：
`{{REPORT_COMMAND}}`
結構不確定時先以此命令加 `--example` 讀範例；groups 用 `{id,title}`，tasks 用 `{id,title,group,status,detail,evidence}`，agents 用 `{id,role,assignment,status,current,next}`。status 只用 `not_started/pending/in_progress/source_ready/passed/done/frozen/blocked`；`done/passed/frozen` 必須附 evidence 陣列，例如 `evidence:["已通過檢查"]` 或 `evidence:[{label:"驗證報告",path:"work/result.json"}]`（元素也可用 `{label,url}`），不能填單一字串。
把短 JSON 寫入 UTF-8 檔，再加上 `--json-file <檔案>`，或經 stdin 傳送並加 `--json-stdin`；私人內容不要直接拼接到 shell 命令。根工作使用真實 `CODEX_THREAD_ID`（合法 UUID），必要時明確 `--session-id <該UUID>`；缺少時不要捏造或與別的聊天室合併。欄位寫繁體中文：title、goal、current、next、summary、phase、groups/tasks（明確可驗證關卡）、agents（角色、實際指派與目前工作）。沒有已定義關卡就不產生完成百分比；工具呼叫、停止、程式碼完成不代表驗收完成。只有已確認的結果才標為完成並附簡短 evidence。Token/費用/工時未知就不填，不估算。

若父工作明確提供看板父 UUID 與穩定分工 ID，只以子代理模式更新該分工 `{status,assignment,current,next,detail,evidence}`，不能覆寫父工作目標或關卡。根代理 spawn 時把此父 UUID、分工 ID、角色放入任務訊息；回報採明確 `--parent-session-id <父UUID> --agent-id <分工ID> --role <角色>`，不可猜父 ID。身為子代理卻沒有父看板 ID 時暫不另建根聊天室卡片，向父代理回報缺少對應資訊即可。若子代理環境 UUID 仍等於父 UUID，不假稱是另一聊天室。敏感內容、帳密、完整對話不進報告。失敗時保持原工作進度、簡短註記待同步，不聲稱所有聊天室已同步。
