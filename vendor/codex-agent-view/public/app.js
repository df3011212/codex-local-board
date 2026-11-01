const API_STATE_URL = "/api/state";
const API_EXCHANGE_URL = "/api/viewer/exchange";
const POLL_INTERVAL_MS = 2_000;
const SESSION_TOKEN_KEY = "codex-agent-view-access-token";
const RECOVERY_CREDENTIAL_KEY = "codex-agent-view-recovery-credential";
const RECOVERY_HEADER = "x-codex-agent-view-recovery";
const ACCESS_HEADER = "x-codex-agent-view-access";
const ACCESS_CLIENT_TTL_MS = 15 * 60 * 1_000;
const RECOVERY_CLIENT_TTL_MS = 30 * 60 * 1_000;
const RECOVERY_REFRESH_THRESHOLD_MS = 5 * 60 * 1_000;
const EXCLUDED_SESSION_KEY = "codex-agent-view-excluded-session";
const LANGUAGE_KEY = "codex-agent-view-language-zh-tw-v1";
const SUPPORTED_LANGUAGES = new Set(["en", "ko", "es", "zh-TW"]);
const KNOWN_STATUSES = new Set([
  "running",
  "waiting",
  "completed",
  "completion_not_observed",
  "stale",
  "interrupted",
  "unknown",
]);
const VIEWER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SIGNED_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const CANONICAL_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MESSAGES = Object.freeze({
  "zh-TW": Object.freeze({
    "metaDescription": "即時查看 Codex 任務進度與參與工作的子代理。",
    "skipToContent": "跳至主要內容",
    "brandHome": "Codex 代理工作看板首頁",
    "brandSubtitle": "即時工作總覽",
    "languageLabel": "語言",
    "connectionConnecting": "正在連線至本機狀態",
    "connectionConnected": "已連線至本機監視器",
    "connectionRetrying": "連線中斷 · 正在重試",
    "authenticationRequired": "需要即時看板授權",
    "heroEyebrow": "CODEX 即時工作",
    "heroTitle": "一眼掌握目前工作進度",
    "heroCopy": "集中查看 Codex 正在處理的任務、參與的子代理，以及各項工作的最近活動。",
    "freshnessAria": "更新資訊",
    "lastUpdatedLabel": "最近更新",
    "notYet": "尚未收到",
    "refreshIntervalLabel": "更新間隔",
    "twoSeconds": "每 2 秒",
    "metricsAria": "任務狀態摘要",
    "parentTasks": "工作項目",
    "currentlyObserved": "目前觀察到的工作",
    "runningAgents": "活動中的代理",
    "workingNow": "正在處理工作",
    "waitingStatus": "等待中",
    "waitingExplanation": "等待輸入或下一個步驟",
    "completedAgents": "已完成的代理",
    "currentView": "目前看板內的數量",
    "liveWork": "即時工作",
    "sessionsHeading": "任務與參與的代理",
    "loadingState": "正在載入狀態。",
    "toolbarAria": "篩選自動觀察到的任務與參與代理",
    "searchLabel": "篩選清單（選填）",
    "searchPlaceholder": "搜尋任務或代理",
    "statusFilterLabel": "工作狀態篩選（選填）",
    "statusAll": "全部狀態",
    "statusRunning": "執行中",
    "statusWaiting": "等待中",
    "statusCompleted": "已完成",
    "statusCompletionNotObserved": "尚未確認結束",
    "statusStale": "狀態已過期 · 尚未確認結束",
    "statusInterrupted": "已中斷",
    "statusUnknown": "狀態未知",
    "completionNotObservedExplanation": "尚未收到這項工作的結束訊號，因此無法確認是否完成。",
    "staleExplanation": "狀態已過期，且尚未收到結束訊號，因此無法確認是否完成。",
    "interruptedExplanation": "整體工作結束時，這項活動仍未關閉；尚未觀察到它自己的完成訊號。",
    "connectingCopy": "正在將此瀏覽器連線至這台電腦上的 Codex 本機監視器。",
    "sessionListAria": "Codex 工作清單",
    "privacyPrompt": "此看板只顯示縮短的需求與代理工作摘要，不顯示完整需求或工具輸入內容。",
    "privacyLocal": "資料僅從這台電腦的本機監視器唯讀取得。",
    "timeUnknown": "時間資料尚未取得",
    "startedUnknown": "開始時間尚未取得",
    "noReceivedActivity": "尚未收到活動",
    "parentTask": "任務",
    "projectUnknown": "專案資訊尚未取得",
    "taskSummary": "需求摘要",
    "taskSummaryUnavailable": "尚未取得這項需求的簡短摘要。",
    "recentActivity": "最近活動",
    "recent": "最近",
    "subagentsCount": "參與的代理 · {count}",
    "subagentName": "代理 {ordinal}",
    "agentProfile": "角色／分工 · {profile}",
    "agentProfileNote": "有可確認的資料時，會顯示各代理的簡短分工摘要與目前活動。",
    "agentAssignment": "指派工作",
    "agentAssignmentUnavailable": "尚未觀察到此代理的工作指派詳情。",
    "agentCurrentActivity": "目前活動",
    "agentCurrentActivityUnavailable": "尚未取得目前活動的詳細資訊。",
    "agentToolRunning": "正在進行：{tool}",
    "agentToolRunningObserved": "正在進行：{tool} · 觀察時間 {time}",
    "agentToolCompletedRecently": "最近活動：{tool} 已完成",
    "agentToolCompletedRecentlyObserved": "最近活動：{tool} 已完成 · 觀察時間 {time}",
    "agentWorkEnded": "代理工作已結束",
    "agentLastActivityCompletionUnconfirmed": "代理工作已結束，但尚未確認最後一項活動是否完成。",
    "agentWaitingForNextStep": "等待輸入或下一個步驟",
    "agentCurrentStatusUnverified": "目前無法確認此代理的狀態。",
    "noSubagents": "尚未觀察到參與此任務的其他代理。",
    "noRecentActivity": "目前沒有可顯示的最近活動。",
    "technicalInfo": "技術資訊",
    "agentId": "代理識別碼",
    "rawProfile": "原始角色／分工",
    "rawEvent": "原始事件名稱",
    "rawTool": "原始工具名稱",
    "retry": "重新連線",
    "retryAuthentication": "重新驗證此分頁",
    "checkAuthentication": "再次檢查授權",
    "reconnectAuthentication": "安全重新連線",
    "recoveryAvailableTitle": "重新連線至此即時看板",
    "recoveryAvailableStep": "此分頁仍有最近取得的唯讀復原授權。",
    "recoveryAvailableNote": "選擇「安全重新連線」，即可在授權期限內恢復此分頁，無需重新開啟 Codex Agent View。",
    "recoveryTitle": "需要取得新的授權",
    "recoveryStep": "請再次雙擊桌面看板入口，或回到 Codex 執行 @codex-agent-view。",
    "recoveryNote": "入口會在預設瀏覽器開啟新的授權分頁。此分頁不能自行建立或替換授權。",
    "resultsFiltered": "顯示 {visible}／{total} 項",
    "resultsTotal": "共 {count} 項工作",
    "searchEmptyTitle": "沒有符合的結果。",
    "searchEmptyCopy": "請調整搜尋文字或工作狀態篩選。",
    "emptyWithDiagnosticsTitle": "目前沒有可顯示的工作。",
    "emptyWithDiagnosticsCopy": "本機監視器已收到 {count} 筆活動，但無法將它們對應為可顯示的工作項目。",
    "emptyTitle": "這次觀察期間尚未收到任務活動。",
    "emptyCopy": "本機監視器已連線；這個結果本身不代表 Codex 沒有正在處理的工作或子代理。",
    "emptyGuidanceTitle": "如果工作沒有出現",
    "hookReviewTitle": "請先檢查 hooks 是否已信任",
    "hookReviewCopy": "監視器尚未收到活動。hooks 可能尚未信任或載入，但此頁面無法讀取 Codex 儲存的信任狀態。",
    "automaticTracking": "不必輸入或登記任務編號。已信任 hooks 傳來的活動會自動加入。",
    "emptyStep1": "在 Codex 開啟 Plugins → Codex Agent View，確認已啟用；如果有 Hooks 的 Review 與 Trust all 按鈕，請先檢閱再信任目前定義。",
    "emptyStep2": "若 App 沒有 hooks 檢閱介面，請在互動式 Codex CLI 執行 /hooks，檢查目前的 Codex Agent View 命令後再批准。",
    "emptyStep3": "安全結束目前工作後，完全關閉並重新開啟 Codex，讓它載入目前的外掛與 hooks 定義。",
    "emptyStep4": "完成信任與重新載入後，建立新對話並開始工作，確認能收到新事件。",
    "viewerTaskHiddenTitle": "開啟看板用的對話已隱藏。",
    "viewerTaskHiddenCopy": "目前唯一觀察到的工作就是開啟此看板的對話，因此顯示清單為空。",
    "viewerTaskActionTitle": "請用另一個對話開啟看板",
    "viewerTaskExclusion": "透過外掛開啟看板的對話會被排除。可用另一個簡短的查看對話開啟，再於原工作對話繼續處理；桌面共用入口則不排除目前工作。",
    "observationBoundary": "從收到第一筆已信任的 hook 事件開始觀察。更早的活動、或本機收集停止時遺漏的事件無法補回；重新啟動收集會建立新的觀察期間。",
    "diagnosticsCount": "驗證資訊 · {count}",
    "diagnosticOccurrences": "出現 {count} 次",
    "disconnectedTitle": "本機狀態連線中斷，正在重試。",
    "authTitle": "目前無法驗證此即時看板的授權。",
    "retryWithState": "每 2 秒自動重新連線，並保留最後一次成功讀取的狀態。",
    "retryWithoutState": "每 2 秒自動重新連線。可以保留此分頁等待，或立即重試。",
    "missingToken": "此分頁缺少顯示即時工作所需的授權。",
    "expiredToken": "此分頁的即時看板授權遭到拒絕或已失效。",
    "requestFailed": "狀態讀取失敗（{status}）",
    "unknownConnectionError": "發生未知的連線錯誤。",
    "offline": "這台電腦目前未連線。",
    "invalidState": "收到的狀態資料格式不正確。",
    "durationSeconds": "{count} 秒",
    "durationMinutes": "{count} 分鐘",
    "durationHours": "{count} 小時",
    "durationHoursMinutes": "{hours} 小時 {minutes} 分鐘",
    "toolFallback": "工具 · {name}",
    "activityFallback": "活動 · {name}",
    "nameUnknown": "名稱未知",
    "activityUnknown": "活動未知",
    "approvalRequest": "{tool} 正在請求批准",
    "agentStarted": "代理 {ordinal} 已開始工作",
    "agentStopped": "代理 {ordinal} 已完成工作",
    "activitySessionStarted": "開始觀察",
    "activitySessionEnded": "觀察結束",
    "activityTurnStarted": "開始處理工作",
    "activityTurnStopped": "本次工作回覆已完成",
    "activitySubagentStarted": "代理開始工作",
    "activitySubagentStopped": "代理工作完成",
    "activityToolStarted": "工具活動",
    "activityToolCompleted": "工具活動",
    "activityPermissionRequested": "正在請求使用者批准",
    "toolApplyPatch": "編輯檔案",
    "toolBash": "終端機活動",
    "toolFollowup": "已指派代理後續工作",
    "toolInterrupt": "已要求中斷代理工作",
    "toolList": "已檢查代理狀態",
    "toolMessage": "已傳送訊息給代理",
    "toolSpawn": "代理開始工作",
    "toolWaitAgent": "等待代理回覆",
    "toolExec": "終端機活動",
    "toolUserInput": "正在請求使用者輸入",
    "toolWait": "等待執行完成",
    "toolStdin": "終端機輸入",
    "roleExplorer": "研究與調查",
    "roleReviewer": "檢查與審閱",
    "roleWorker": "功能實作",
    "roleDefault": "一般代理",
    "roleUnknown": "尚未回報"
}),
  en: Object.freeze({
    metaDescription: "A clear, live view of Codex work and the agents moving it forward.",
    skipToContent: "Skip to content",
    brandHome: "Codex Agent View home",
    brandSubtitle: "Live work overview",
    languageLabel: "Language",
    connectionConnecting: "Connecting to local status",
    connectionConnected: "Local monitor connected",
    connectionRetrying: "Disconnected · retrying",
    authenticationRequired: "Live view authentication required",
    heroEyebrow: "LIVE CODEX WORK",
    heroTitle: "See active work at a glance",
    heroCopy: "See what Codex is working on, which agents are involved, and how each part is progressing—all in one place.",
    freshnessAria: "Refresh information",
    lastUpdatedLabel: "Last updated",
    notYet: "Not yet",
    refreshIntervalLabel: "Refresh interval",
    twoSeconds: "2 seconds",
    metricsAria: "Task status summary",
    parentTasks: "Work items",
    currentlyObserved: "Currently observed",
    runningAgents: "Active agents",
    workingNow: "Working now",
    waitingStatus: "Waiting",
    waitingExplanation: "Waiting for input or the next step",
    completedAgents: "Completed agents",
    currentView: "In the current view",
    liveWork: "LIVE WORK",
    sessionsHeading: "Work and participating agents",
    loadingState: "Loading status.",
    toolbarAria: "Filter automatically observed work and participating agents",
    searchLabel: "Filter list (optional)",
    searchPlaceholder: "Find work or an agent",
    statusFilterLabel: "Work status filter (optional)",
    statusAll: "All statuses",
    statusRunning: "Running",
    statusWaiting: "Waiting",
    statusCompleted: "Completed",
    statusCompletionNotObserved: "End not confirmed",
    statusStale: "Stale · end not confirmed",
    statusInterrupted: "Interrupted",
    statusUnknown: "Unknown",
    completionNotObservedExplanation: "No end signal was received for this item, so completion cannot be confirmed.",
    staleExplanation: "This status is out of date and no end signal was received. Completion cannot be confirmed.",
    interruptedExplanation: "This activity was still open when the work ended; its own completion signal was not observed.",
    connectingCopy: "Connecting this browser to the local Codex monitor on this device.",
    sessionListAria: "Codex work list",
    privacyPrompt: "This view shows only shortened request and agent-work summaries; it never displays full requests or tool inputs.",
    privacyLocal: "Data is read only from the local monitor on this device.",
    timeUnknown: "Time unavailable",
    startedUnknown: "Start time unavailable",
    noReceivedActivity: "No activity received",
    parentTask: "WORK",
    projectUnknown: "Project unavailable",
    taskSummary: "Request",
    taskSummaryUnavailable: "A short request summary is not available yet.",
    recentActivity: "Recent activity",
    recent: "Recent",
    subagentsCount: "Participating agents · {count}",
    subagentName: "Agent {ordinal}",
    agentProfile: "Role/profile · {profile}",
    agentProfileNote: "When available, each agent shows a shortened assigned-work summary and current activity.",
    agentAssignment: "Assigned work",
    agentAssignmentUnavailable: "No assignment detail was observed for this agent.",
    agentCurrentActivity: "Current activity",
    agentCurrentActivityUnavailable: "Current activity details are not available yet.",
    agentToolRunning: "{tool} in progress",
    agentToolRunningObserved: "{tool} in progress · observed {time}",
    agentToolCompletedRecently: "Recent activity: {tool} completed",
    agentToolCompletedRecentlyObserved: "Recent activity: {tool} completed · observed {time}",
    agentWorkEnded: "Agent work ended",
    agentLastActivityCompletionUnconfirmed: "Agent work ended, but completion of its last activity was not confirmed.",
    agentWaitingForNextStep: "Waiting for input or the next step",
    agentCurrentStatusUnverified: "The agent's current status could not be verified.",
    noSubagents: "No participating agents have been observed for this work item.",
    noRecentActivity: "No recent activity to display.",
    technicalInfo: "Technical information",
    agentId: "Agent ID",
    rawProfile: "Raw role/profile",
    rawEvent: "Raw event",
    rawTool: "Raw tool",
    retry: "Retry connection",
    retryAuthentication: "Try this tab again",
    checkAuthentication: "Check authentication again",
    reconnectAuthentication: "Reconnect securely",
    recoveryAvailableTitle: "Reconnect this live view",
    recoveryAvailableStep: "This tab has a recent, read-only recovery credential.",
    recoveryAvailableNote: "Select Reconnect securely to restore this browser tab without reopening Codex Agent View.",
    recoveryTitle: "New authentication is required",
    recoveryStep: "Return to the Codex app and run @codex-agent-view again.",
    recoveryNote: "Codex Agent View opens a newly authenticated page in your default browser. For safety, this page cannot create or replace its own authentication.",
    resultsFiltered: "Showing {visible} of {total}",
    resultsTotal: "{count} work items",
    searchEmptyTitle: "No matching results.",
    searchEmptyCopy: "Try changing the search term or status filter.",
    emptyWithDiagnosticsTitle: "No work can be displayed.",
    emptyWithDiagnosticsCopy: "The local monitor received {count} activity records but could not apply them to displayable work items.",
    emptyTitle: "No task activity has been received in this observation window.",
    emptyCopy: "The local monitor is connected. This result alone does not mean that Codex has no active work or participating agents.",
    emptyGuidanceTitle: "If work does not appear",
    hookReviewTitle: "Check hook approval first",
    hookReviewCopy: "No activity has reached this monitor. The hook may not be trusted or loaded yet, but this page cannot inspect Codex's saved hook-trust state.",
    automaticTracking: "You do not need to enter or register task IDs. Activity from trusted hooks is added automatically.",
    emptyStep1: "In the Codex app, open Plugins > Codex Agent View, confirm that it is enabled, choose Review under Hooks, and then choose Trust all if those controls are available.",
    emptyStep2: "If the app has no hook-review controls, open the interactive Codex CLI, run /hooks, inspect the current Codex Agent View command, and approve it.",
    emptyStep3: "Fully quit and restart the official Codex app so it loads the current plugin and hook definition.",
    emptyStep4: "After approval and restart, create a new task and start new work to verify delivery.",
    viewerTaskHiddenTitle: "The viewer task is hidden from this page.",
    viewerTaskHiddenCopy: "The only observed work item is the task that opened this view, so the visible list is empty.",
    viewerTaskActionTitle: "Open the viewer from a separate task",
    viewerTaskExclusion: "The task that opened this view is intentionally excluded. Open Codex Agent View from a separate lightweight viewer task, then start or continue the work you want to monitor in another task.",
    observationBoundary: "Observation starts with the first trusted hook event. Earlier activity and activity missed while local collection was stopped cannot be replayed; restarting collection opens a new observation window.",
    diagnosticsCount: "Validation information · {count}",
    diagnosticOccurrences: "{count} occurrences",
    disconnectedTitle: "Local status disconnected; retrying.",
    authTitle: "This live view cannot be authenticated.",
    retryWithState: "Reconnecting automatically every 2 seconds while keeping the last good state visible.",
    retryWithoutState: "Reconnecting automatically every 2 seconds. You can leave this browser tab open or retry immediately.",
    missingToken: "This tab does not have the authentication needed to display live work.",
    expiredToken: "This tab's live-view authentication was rejected or is no longer valid.",
    requestFailed: "Status request failed ({status})",
    unknownConnectionError: "An unknown connection error occurred.",
    offline: "This device is offline.",
    invalidState: "The status response format is invalid.",
    durationSeconds: "{count}s",
    durationMinutes: "{count}m",
    durationHours: "{count}h",
    durationHoursMinutes: "{hours}h {minutes}m",
    toolFallback: "Tool · {name}",
    activityFallback: "Activity · {name}",
    nameUnknown: "Unknown name",
    activityUnknown: "Unknown",
    approvalRequest: "{tool} approval requested",
    agentStarted: "Agent {ordinal} started",
    agentStopped: "Agent {ordinal} completed",
    activitySessionStarted: "Observation started",
    activitySessionEnded: "Observation ended",
    activityTurnStarted: "Work started",
    activityTurnStopped: "Work response completed",
    activitySubagentStarted: "Agent started",
    activitySubagentStopped: "Agent completed",
    activityToolStarted: "Tool activity",
    activityToolCompleted: "Tool activity",
    activityPermissionRequested: "User approval requested",
    toolApplyPatch: "File edit",
    toolBash: "Terminal activity",
    toolFollowup: "Agent follow-up requested",
    toolInterrupt: "Agent interruption requested",
    toolList: "Agent status checked",
    toolMessage: "Message sent to agent",
    toolSpawn: "Agent started",
    toolWaitAgent: "Waiting for agent",
    toolExec: "Terminal activity",
    toolUserInput: "User input requested",
    toolWait: "Waiting for completion",
    toolStdin: "Terminal input",
    roleExplorer: "Research",
    roleReviewer: "Review",
    roleWorker: "Implementation",
    roleDefault: "General agent",
    roleUnknown: "Not reported",
  }),
  ko: Object.freeze({
    metaDescription: "Codex가 수행 중인 작업과 참여 에이전트의 진행 상황을 한눈에 확인합니다.",
    skipToContent: "본문으로 건너뛰기",
    brandHome: "Codex Agent View 홈",
    brandSubtitle: "실시간 작업 현황",
    languageLabel: "언어",
    connectionConnecting: "로컬 상태 연결 중",
    connectionConnected: "로컬 모니터 연결됨",
    connectionRetrying: "연결 끊김 · 재시도 중",
    authenticationRequired: "실시간 화면 인증 필요",
    heroEyebrow: "CODEX 작업 현황",
    heroTitle: "작업 흐름을 한눈에",
    heroCopy: "Codex가 어떤 요청을 처리하고 있는지, 어떤 에이전트가 참여하는지, 각 단계가 어디까지 왔는지 한 화면에서 확인하세요.",
    freshnessAria: "상태 갱신 정보",
    lastUpdatedLabel: "마지막 갱신",
    notYet: "아직 없음",
    refreshIntervalLabel: "갱신 주기",
    twoSeconds: "2초",
    metricsAria: "작업 상태 요약",
    parentTasks: "작업",
    currentlyObserved: "현재 관찰 중",
    runningAgents: "실행 중 에이전트",
    workingNow: "작업 수행 중",
    waitingStatus: "대기 상태",
    waitingExplanation: "사용자 응답 또는 다음 작업 대기",
    completedAgents: "완료 에이전트",
    currentView: "현재 화면 기준",
    liveWork: "실시간 작업",
    sessionsHeading: "작업과 참여 에이전트",
    loadingState: "상태를 불러오는 중입니다.",
    toolbarAria: "자동 수신된 작업과 참여 에이전트 목록 필터",
    searchLabel: "목록 필터 (선택)",
    searchPlaceholder: "작업 또는 에이전트 찾기",
    statusFilterLabel: "작업 상태 필터 (선택)",
    statusAll: "모든 상태",
    statusRunning: "실행 중",
    statusWaiting: "대기",
    statusCompleted: "완료",
    statusCompletionNotObserved: "종료 확인 안 됨",
    statusStale: "오래된 상태 · 종료 확인 안 됨",
    statusInterrupted: "중단됨",
    statusUnknown: "알 수 없음",
    completionNotObservedExplanation: "이 항목의 종료 신호를 받지 못해 완료 여부를 확정할 수 없습니다.",
    staleExplanation: "상태 정보가 오래되었고 종료 신호를 받지 못했습니다. 완료 여부를 확정할 수 없습니다.",
    interruptedExplanation: "전체 작업이 끝날 때 이 활동이 열린 상태였습니다. 이 활동 자체의 완료 신호는 확인되지 않았습니다.",
    connectingCopy: "이 브라우저를 기기의 로컬 Codex 모니터에 연결하고 있습니다.",
    sessionListAria: "Codex 작업 목록",
    privacyPrompt: "이 화면은 짧게 줄인 요청과 에이전트 작업 요약만 표시하며, 전체 요청이나 도구 입력은 표시하지 않습니다.",
    privacyLocal: "데이터는 이 기기의 로컬 모니터에서만 읽습니다.",
    timeUnknown: "시간 정보 없음",
    startedUnknown: "시작 시간 없음",
    noReceivedActivity: "수신된 활동 없음",
    parentTask: "작업",
    projectUnknown: "프로젝트 정보 없음",
    taskSummary: "요청 내용",
    taskSummaryUnavailable: "요청 내용을 요약할 수 있는 정보가 아직 없습니다.",
    recentActivity: "최근 활동",
    recent: "최근",
    subagentsCount: "참여 에이전트 · {count}",
    subagentName: "에이전트 {ordinal}",
    agentProfile: "역할/프로필 · {profile}",
    agentProfileNote: "확인 가능한 경우 각 에이전트에 짧게 줄인 할당 작업 요약과 현재 활동을 표시합니다.",
    agentAssignment: "할당된 작업",
    agentAssignmentUnavailable: "이 에이전트의 할당 작업 설명을 확인하지 못했습니다.",
    agentCurrentActivity: "현재 작업",
    agentCurrentActivityUnavailable: "현재 작업 정보를 아직 확인할 수 없습니다.",
    agentToolRunning: "{tool} 진행 중",
    agentToolRunningObserved: "{tool} 진행 중 · {time} 확인",
    agentToolCompletedRecently: "최근 활동: {tool} 완료",
    agentToolCompletedRecentlyObserved: "최근 활동: {tool} 완료 · {time} 확인",
    agentWorkEnded: "에이전트 작업 종료 확인됨",
    agentLastActivityCompletionUnconfirmed: "에이전트 작업 종료는 확인됐지만 마지막 활동의 완료는 확인되지 않았습니다.",
    agentWaitingForNextStep: "입력 또는 다음 단계를 기다리는 중",
    agentCurrentStatusUnverified: "에이전트의 현재 상태를 확인할 수 없습니다.",
    noSubagents: "이 작업에 참여한 에이전트가 아직 관찰되지 않았습니다.",
    noRecentActivity: "표시할 최근 활동이 없습니다.",
    technicalInfo: "기술 정보",
    agentId: "에이전트 ID",
    rawProfile: "원본 역할/프로필",
    rawEvent: "원본 이벤트",
    rawTool: "원본 도구",
    retry: "연결 다시 시도",
    retryAuthentication: "이 탭에서 다시 시도",
    checkAuthentication: "인증 정보 다시 확인",
    reconnectAuthentication: "안전하게 다시 연결",
    recoveryAvailableTitle: "이 실시간 화면 다시 연결",
    recoveryAvailableStep: "이 탭에 최근 발급된 읽기 전용 복구 인증 정보가 있습니다.",
    recoveryAvailableNote: "안전하게 다시 연결을 누르면 Codex Agent View를 다시 열지 않고 이 브라우저 탭의 접근을 복구합니다.",
    recoveryTitle: "새 인증이 필요합니다",
    recoveryStep: "Codex 앱으로 돌아가 @codex-agent-view를 다시 실행하세요.",
    recoveryNote: "Codex Agent View가 기본 브라우저에 새 인증 화면을 엽니다. 안전을 위해 이 페이지 자체에서는 인증 정보를 만들거나 교체할 수 없습니다.",
    resultsFiltered: "전체 {total}개 중 {visible}개 표시",
    resultsTotal: "작업 {count}개",
    searchEmptyTitle: "검색 결과가 없습니다.",
    searchEmptyCopy: "검색어나 상태 필터를 바꿔 보세요.",
    emptyWithDiagnosticsTitle: "표시 가능한 작업이 없습니다.",
    emptyWithDiagnosticsCopy: "로컬 모니터가 활동 정보 {count}건을 받았지만 표시 가능한 작업으로 적용하지 못했습니다.",
    emptyTitle: "이 관찰 화면에서 수신된 작업 활동이 없습니다.",
    emptyCopy: "로컬 모니터 연결은 정상입니다. 이 결과만으로 Codex에 진행 중인 작업이나 참여 에이전트가 없다고 판단할 수 없습니다.",
    emptyGuidanceTitle: "표시되지 않을 때 확인 순서",
    hookReviewTitle: "먼저 Hook 승인 상태를 확인하세요",
    hookReviewCopy: "아직 이 모니터에 도착한 활동이 없습니다. Hook이 신뢰되지 않았거나 아직 로드되지 않았을 수 있지만, 이 화면에서는 Codex에 저장된 Hook 신뢰 상태를 확인할 수 없습니다.",
    automaticTracking: "작업 ID를 입력하거나 작업별로 등록할 필요가 없습니다. 신뢰한 hook의 작업 활동이 이 목록에 자동으로 추가됩니다.",
    emptyStep1: "Codex 앱에서 Plugins > Codex Agent View를 열어 활성화 상태를 확인하고, Hooks에서 '검토'를 누른 뒤 해당 버튼이 보이면 '모두 신뢰하기'를 선택합니다.",
    emptyStep2: "앱에 Hook 검토 화면이 없다면 interactive Codex CLI에서 /hooks를 실행하고 현재 Codex Agent View 명령을 검토한 뒤 승인합니다.",
    emptyStep3: "현재 플러그인과 Hook 정의를 다시 로드하도록 공식 Codex 앱을 완전히 종료한 뒤 재시작합니다.",
    emptyStep4: "승인과 재시작을 마친 뒤 새 작업을 만들고 새로운 활동을 시작해 전달 여부를 확인합니다.",
    viewerTaskHiddenTitle: "이 화면을 연 작업은 목록에서 숨겨집니다.",
    viewerTaskHiddenCopy: "현재 관찰된 유일한 작업이 이 화면을 연 작업이므로 표시 목록이 비어 있습니다.",
    viewerTaskActionTitle: "별도의 작업에서 보기 화면을 여세요",
    viewerTaskExclusion: "이 화면을 연 작업은 의도적으로 제외됩니다. 별도의 가벼운 보기용 작업에서 Codex Agent View를 연 뒤, 다른 작업에서 관찰할 새 작업을 시작하거나 기존 작업을 계속하세요.",
    observationBoundary: "관찰 화면은 첫 번째로 신뢰한 hook을 받은 시점부터 시작합니다. 그 전에 이미 지나간 활동과 로컬 상태 수집이 중단된 동안의 활동은 재생되지 않으며, 수집이 다시 시작되면 새 관찰 화면이 열립니다.",
    diagnosticsCount: "검증 정보 · {count}건",
    diagnosticOccurrences: "{count}건",
    disconnectedTitle: "로컬 상태 연결이 끊겨 다시 시도 중입니다.",
    authTitle: "이 실시간 화면을 인증할 수 없습니다.",
    retryWithState: "2초마다 자동으로 다시 연결합니다. 마지막 정상 상태를 계속 표시합니다.",
    retryWithoutState: "2초마다 자동으로 다시 연결합니다. 이 브라우저 탭을 열어 두거나 지금 바로 다시 시도할 수 있습니다.",
    missingToken: "이 탭에는 실시간 작업을 표시하는 데 필요한 인증 정보가 없습니다.",
    expiredToken: "이 탭의 실시간 화면 인증이 거부되었거나 더 이상 유효하지 않습니다.",
    requestFailed: "상태 요청 실패 ({status})",
    unknownConnectionError: "알 수 없는 연결 오류가 발생했습니다.",
    offline: "이 기기가 오프라인입니다.",
    invalidState: "상태 응답 형식이 올바르지 않습니다.",
    durationSeconds: "{count}초",
    durationMinutes: "{count}분",
    durationHours: "{count}시간",
    durationHoursMinutes: "{hours}시간 {minutes}분",
    toolFallback: "도구 · {name}",
    activityFallback: "활동 · {name}",
    nameUnknown: "이름 미상",
    activityUnknown: "알 수 없음",
    approvalRequest: "{tool} 승인 요청",
    agentStarted: "에이전트 {ordinal} 시작",
    agentStopped: "에이전트 {ordinal} 완료",
    activitySessionStarted: "관찰 시작",
    activitySessionEnded: "관찰 종료",
    activityTurnStarted: "작업 시작",
    activityTurnStopped: "작업 응답 완료",
    activitySubagentStarted: "에이전트 시작",
    activitySubagentStopped: "에이전트 완료",
    activityToolStarted: "도구 작업",
    activityToolCompleted: "도구 작업",
    activityPermissionRequested: "사용자 승인 요청",
    toolApplyPatch: "파일 수정",
    toolBash: "터미널 작업",
    toolFollowup: "에이전트 후속 작업 요청",
    toolInterrupt: "에이전트 작업 중단 요청",
    toolList: "에이전트 상태 확인",
    toolMessage: "에이전트에게 메시지 전달",
    toolSpawn: "에이전트 시작",
    toolWaitAgent: "에이전트 응답 대기",
    toolExec: "터미널 작업",
    toolUserInput: "사용자 입력 요청",
    toolWait: "작업 완료 대기",
    toolStdin: "터미널 입력",
    roleExplorer: "조사",
    roleReviewer: "검토",
    roleWorker: "구현",
    roleDefault: "일반 에이전트",
    roleUnknown: "보고되지 않음",
  }),
  es: Object.freeze({
    metaDescription: "Una vista clara del trabajo de Codex y de los agentes que lo hacen avanzar.",
    skipToContent: "Saltar al contenido",
    brandHome: "Inicio de Codex Agent View",
    brandSubtitle: "Resumen del trabajo en vivo",
    languageLabel: "Idioma",
    connectionConnecting: "Conectando al estado local",
    connectionConnected: "Monitor local conectado",
    connectionRetrying: "Desconectado · reintentando",
    authenticationRequired: "Se requiere autenticar la vista",
    heroEyebrow: "TRABAJO ACTIVO EN CODEX",
    heroTitle: "Observa el trabajo activo de un vistazo",
    heroCopy: "Consulta qué está haciendo Codex, qué agentes participan y cómo avanza cada parte, todo en un solo lugar.",
    freshnessAria: "Información de actualización",
    lastUpdatedLabel: "Última actualización",
    notYet: "Aún no",
    refreshIntervalLabel: "Intervalo de actualización",
    twoSeconds: "2 segundos",
    metricsAria: "Resumen del estado de las tareas",
    parentTasks: "Trabajos",
    currentlyObserved: "En observación",
    runningAgents: "Agentes activos",
    workingNow: "Trabajando ahora",
    waitingStatus: "En espera",
    waitingExplanation: "Esperando una respuesta o el siguiente paso",
    completedAgents: "Agentes que terminaron",
    currentView: "En la vista actual",
    liveWork: "TRABAJO EN VIVO",
    sessionsHeading: "Trabajos y agentes participantes",
    loadingState: "Cargando el estado.",
    toolbarAria: "Filtrar trabajos y agentes participantes observados automáticamente",
    searchLabel: "Filtrar lista (opcional)",
    searchPlaceholder: "Buscar un trabajo o agente",
    statusFilterLabel: "Filtro por estado del trabajo (opcional)",
    statusAll: "Todos los estados",
    statusRunning: "En ejecución",
    statusWaiting: "En espera",
    statusCompleted: "Completado",
    statusCompletionNotObserved: "Fin no confirmado",
    statusStale: "Estado desactualizado · fin no confirmado",
    statusInterrupted: "Interrumpido",
    statusUnknown: "Desconocido",
    completionNotObservedExplanation: "No se recibió una señal de fin para este elemento, por lo que no se puede confirmar que haya terminado.",
    staleExplanation: "El estado está desactualizado y no se recibió una señal de fin. No se puede confirmar que haya terminado.",
    interruptedExplanation: "Esta actividad seguía abierta cuando terminó el trabajo; no se observó su propia señal de finalización.",
    connectingCopy: "Conectando este navegador al monitor local de Codex en este dispositivo.",
    sessionListAria: "Lista de trabajos de Codex",
    privacyPrompt: "Esta vista solo muestra resúmenes abreviados de solicitudes y trabajo de agentes; nunca muestra solicitudes completas ni entradas de herramientas.",
    privacyLocal: "Los datos se leen únicamente del monitor local de este dispositivo.",
    timeUnknown: "Hora no disponible",
    startedUnknown: "Hora de inicio no disponible",
    noReceivedActivity: "No se recibió actividad",
    parentTask: "TRABAJO",
    projectUnknown: "Proyecto no disponible",
    taskSummary: "Solicitud",
    taskSummaryUnavailable: "Todavía no hay información para resumir esta solicitud.",
    recentActivity: "Actividad reciente",
    recent: "Reciente",
    subagentsCount: "Agentes participantes · {count}",
    subagentName: "Agente {ordinal}",
    agentProfile: "Rol/perfil · {profile}",
    agentProfileNote: "Cuando está disponible, cada agente muestra un resumen abreviado del trabajo asignado y su actividad actual.",
    agentAssignment: "Trabajo asignado",
    agentAssignmentUnavailable: "No se observó información sobre el trabajo asignado de este agente.",
    agentCurrentActivity: "Actividad actual",
    agentCurrentActivityUnavailable: "Los detalles de la actividad actual aún no están disponibles.",
    agentToolRunning: "{tool} en curso",
    agentToolRunningObserved: "{tool} en curso · observado {time}",
    agentToolCompletedRecently: "Actividad reciente: {tool} completada",
    agentToolCompletedRecentlyObserved: "Actividad reciente: {tool} completada · observada {time}",
    agentWorkEnded: "Fin del trabajo del agente confirmado",
    agentLastActivityCompletionUnconfirmed: "El trabajo del agente terminó, pero no se confirmó que su última actividad se completara.",
    agentWaitingForNextStep: "Esperando una respuesta o el siguiente paso",
    agentCurrentStatusUnverified: "No se pudo verificar el estado actual del agente.",
    noSubagents: "Todavía no se observaron agentes participantes en este trabajo.",
    noRecentActivity: "No hay actividad reciente que mostrar.",
    technicalInfo: "Información técnica",
    agentId: "ID del agente",
    rawProfile: "Rol/perfil original",
    rawEvent: "Evento original",
    rawTool: "Herramienta original",
    retry: "Reintentar conexión",
    retryAuthentication: "Reintentar en esta pestaña",
    checkAuthentication: "Volver a comprobar la autenticación",
    reconnectAuthentication: "Reconectar de forma segura",
    recoveryAvailableTitle: "Reconectar esta vista en vivo",
    recoveryAvailableStep: "Esta pestaña tiene una credencial reciente de recuperación de solo lectura.",
    recoveryAvailableNote: "Selecciona Reconectar de forma segura para recuperar esta pestaña sin volver a abrir Codex Agent View.",
    recoveryTitle: "Se necesita una autenticación nueva",
    recoveryStep: "Vuelve a la aplicación Codex y ejecuta @codex-agent-view de nuevo.",
    recoveryNote: "Codex Agent View abre una página recién autenticada en tu navegador predeterminado. Por seguridad, esta página no puede crear ni reemplazar su propia autenticación.",
    resultsFiltered: "Mostrando {visible} de {total}",
    resultsTotal: "{count} trabajos",
    searchEmptyTitle: "No hay resultados.",
    searchEmptyCopy: "Prueba otra búsqueda o filtro de estado.",
    emptyWithDiagnosticsTitle: "No hay trabajos que mostrar.",
    emptyWithDiagnosticsCopy: "El monitor local recibió {count} registros de actividad, pero no pudo aplicarlos a trabajos visibles.",
    emptyTitle: "No se recibió actividad en esta ventana de observación.",
    emptyCopy: "El monitor local está conectado. Este resultado no implica por sí solo que Codex no tenga trabajos o agentes activos.",
    emptyGuidanceTitle: "Si el trabajo no aparece",
    hookReviewTitle: "Comprueba primero la aprobación del hook",
    hookReviewCopy: "Aún no llegó actividad a este monitor. Es posible que el hook todavía no sea confiable o no esté cargado, pero esta página no puede consultar el estado de confianza guardado por Codex.",
    automaticTracking: "No es necesario introducir ni registrar IDs de tareas. La actividad de hooks confiables se añade automáticamente.",
    emptyStep1: "En la aplicación Codex, abre Plugins > Codex Agent View, confirma que esté activado, elige Revisar en Hooks y después Confiar en todos si aparecen esos controles.",
    emptyStep2: "Si la aplicación no tiene controles para revisar hooks, abre la CLI interactiva de Codex, ejecuta /hooks, inspecciona el comando actual de Codex Agent View y apruébalo.",
    emptyStep3: "Cierra por completo y reinicia la aplicación oficial de Codex para que cargue el plugin y la definición de hook actuales.",
    emptyStep4: "Después de aprobar y reiniciar, crea una tarea nueva e inicia trabajo nuevo para verificar la entrega.",
    viewerTaskHiddenTitle: "La tarea que abrió esta vista está oculta.",
    viewerTaskHiddenCopy: "El único trabajo observado es la tarea que abrió esta vista, por eso la lista visible está vacía.",
    viewerTaskActionTitle: "Abre el visor desde otra tarea",
    viewerTaskExclusion: "La tarea que abrió esta vista se excluye intencionalmente. Abre Codex Agent View desde otra tarea ligera de visualización y después inicia o continúa el trabajo que quieras observar en una tarea diferente.",
    observationBoundary: "La observación comienza con el primer evento de un hook autorizado. La actividad anterior o perdida mientras la recopilación local estuvo detenida no se puede reproducir; al reiniciarla se abre una ventana nueva.",
    diagnosticsCount: "Información de validación · {count}",
    diagnosticOccurrences: "{count} apariciones",
    disconnectedTitle: "Se perdió la conexión local; reintentando.",
    authTitle: "No se puede autenticar esta vista en vivo.",
    retryWithState: "Se reconecta automáticamente cada 2 segundos y mantiene visible el último estado válido.",
    retryWithoutState: "Se reconecta automáticamente cada 2 segundos. Puedes dejar abierta esta pestaña o reintentar de inmediato.",
    missingToken: "Esta pestaña no tiene la autenticación necesaria para mostrar el trabajo en vivo.",
    expiredToken: "La autenticación de esta pestaña fue rechazada o ya no es válida.",
    requestFailed: "Falló la solicitud de estado ({status})",
    unknownConnectionError: "Se produjo un error de conexión desconocido.",
    offline: "Este dispositivo está sin conexión.",
    invalidState: "El formato de la respuesta de estado no es válido.",
    durationSeconds: "{count} s",
    durationMinutes: "{count} min",
    durationHours: "{count} h",
    durationHoursMinutes: "{hours} h {minutes} min",
    toolFallback: "Herramienta · {name}",
    activityFallback: "Actividad · {name}",
    nameUnknown: "Nombre desconocido",
    activityUnknown: "Desconocida",
    approvalRequest: "Se solicitó aprobación para {tool}",
    agentStarted: "Agente {ordinal} iniciado",
    agentStopped: "Agente {ordinal} completado",
    activitySessionStarted: "Observación iniciada",
    activitySessionEnded: "Observación finalizada",
    activityTurnStarted: "Trabajo iniciado",
    activityTurnStopped: "Respuesta del trabajo completada",
    activitySubagentStarted: "Agente iniciado",
    activitySubagentStopped: "Agente completado",
    activityToolStarted: "Actividad de herramienta",
    activityToolCompleted: "Actividad de herramienta",
    activityPermissionRequested: "Se solicitó aprobación",
    toolApplyPatch: "Edición de archivo",
    toolBash: "Actividad de terminal",
    toolFollowup: "Seguimiento del agente solicitado",
    toolInterrupt: "Interrupción del agente solicitada",
    toolList: "Estado de agentes consultado",
    toolMessage: "Mensaje enviado al agente",
    toolSpawn: "Agente iniciado",
    toolWaitAgent: "Esperando al agente",
    toolExec: "Actividad de terminal",
    toolUserInput: "Se solicitó entrada del usuario",
    toolWait: "Esperando finalización",
    toolStdin: "Entrada de terminal",
    roleExplorer: "Investigación",
    roleReviewer: "Revisión",
    roleWorker: "Implementación",
    roleDefault: "Agente general",
    roleUnknown: "No informado",
  }),
});

const STATUS_KEYS = Object.freeze({
  running: "statusRunning",
  waiting: "statusWaiting",
  completed: "statusCompleted",
  completion_not_observed: "statusCompletionNotObserved",
  stale: "statusStale",
  interrupted: "statusInterrupted",
  unknown: "statusUnknown",
});

const STATUS_ORDER = Object.freeze({
  running: 0,
  waiting: 1,
  completion_not_observed: 2,
  stale: 2,
  interrupted: 3,
  unknown: 4,
  completed: 5,
});

const STATUS_EXPLANATION_KEYS = Object.freeze({
  completion_not_observed: "completionNotObservedExplanation",
  stale: "staleExplanation",
  interrupted: "interruptedExplanation",
});

const ACTIVITY_KEYS = Object.freeze({
  session_started: "activitySessionStarted",
  session_ended: "activitySessionEnded",
  turn_started: "activityTurnStarted",
  turn_stopped: "activityTurnStopped",
  subagent_started: "activitySubagentStarted",
  subagent_stopped: "activitySubagentStopped",
  tool_started: "activityToolStarted",
  tool_completed: "activityToolCompleted",
  permission_requested: "activityPermissionRequested",
});

const TOOL_KEYS = Object.freeze({
  apply_patch: "toolApplyPatch",
  bash: "toolBash",
  collaborationfollowup_task: "toolFollowup",
  collaborationinterrupt_agent: "toolInterrupt",
  collaborationlist_agents: "toolList",
  collaborationsend_message: "toolMessage",
  collaborationspawn_agent: "toolSpawn",
  collaborationwait_agent: "toolWaitAgent",
  exec_command: "toolExec",
  request_user_input: "toolUserInput",
  wait: "toolWait",
  write_stdin: "toolStdin",
});

const AGENT_ROLE_KEYS = Object.freeze({
  explorer: "roleExplorer",
  reviewer: "roleReviewer",
  worker: "roleWorker",
  default: "roleDefault",
  unknown: "roleUnknown",
});

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

function readStoredLanguage() {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    return SUPPORTED_LANGUAGES.has(stored) ? stored : "zh-TW";
  } catch {
    return "zh-TW";
  }
}

let currentLanguage = readStoredLanguage();

function t(key, replacements = {}) {
  const template = MESSAGES[currentLanguage][key] ?? MESSAGES.en[key] ?? key;
  return Object.entries(replacements).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

function isExactLiveFragment(entries) {
  const tokenEntries = entries.filter(([key]) => key === "token");
  const grantEntries = entries.filter(([key]) => key === "grant");
  const excludeEntries = entries.filter(([key]) => key === "exclude");
  const validGrant =
    entries.length === 1 &&
    grantEntries.length === 1 &&
    SIGNED_CREDENTIAL_PATTERN.test(grantEntries[0][1]) &&
    grantEntries[0][1].length <= 1_024;
  const validLegacyToken =
    entries.length === tokenEntries.length + excludeEntries.length &&
    tokenEntries.length === 1 &&
    excludeEntries.length <= 1 &&
    VIEWER_TOKEN_PATTERN.test(tokenEntries[0][1]) &&
    (excludeEntries.length === 0 || CANONICAL_SESSION_ID_PATTERN.test(excludeEntries[0][1]));
  return validGrant || validLegacyToken;
}

function consumeLiveContext() {
  const hasFragment = window.location.hash.length > 1;
  const entries = hasFragment
    ? [...new URLSearchParams(window.location.hash.slice(1)).entries()]
    : [];
  const validFragment = hasFragment && isExactLiveFragment(entries);
  const fragmentGrant = validFragment
    ? entries.find(([key]) => key === "grant")?.[1] || ""
    : "";
  const fragmentToken = validFragment
    ? entries.find(([key]) => key === "token")?.[1] || ""
    : "";
  const fragmentExclude = validFragment
    ? entries.find(([key]) => key === "exclude")?.[1] || ""
    : "";

  if (window.location.hash) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }

  let token = fragmentToken;
  let excludedSessionId = fragmentExclude;
  try {
    if (validFragment) {
      window.sessionStorage.removeItem(RECOVERY_CREDENTIAL_KEY);
    }
    if (fragmentGrant) {
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
      window.sessionStorage.removeItem(EXCLUDED_SESSION_KEY);
    } else if (validFragment && fragmentToken) {
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, fragmentToken);
      if (fragmentExclude) {
        window.sessionStorage.setItem(EXCLUDED_SESSION_KEY, fragmentExclude);
      } else {
        window.sessionStorage.removeItem(EXCLUDED_SESSION_KEY);
      }
    } else if (!fragmentGrant) {
      token = window.sessionStorage.getItem(SESSION_TOKEN_KEY)?.trim() || "";
      excludedSessionId = window.sessionStorage.getItem(EXCLUDED_SESSION_KEY)?.trim() || "";
    }
  } catch {
    // Storage can be unavailable in hardened browser contexts. The fragment
    // token remains usable for this page load and is never copied elsewhere.
  }

  return {
    accessToken: VIEWER_TOKEN_PATTERN.test(token) ? token : "",
    bootstrapCredential: SIGNED_CREDENTIAL_PATTERN.test(fragmentGrant)
      ? fragmentGrant
      : "",
    excludedSessionId: CANONICAL_SESSION_ID_PATTERN.test(excludedSessionId)
      ? excludedSessionId
      : "",
  };
}

let { accessToken, bootstrapCredential, excludedSessionId } = consumeLiveContext();
let recoveredAccessToken = "";
let authenticationExchangeInFlight = false;

function readRecoveryCredential() {
  try {
    const raw = window.sessionStorage.getItem(RECOVERY_CREDENTIAL_KEY);
    if (!raw) return "";
    const value = JSON.parse(raw);
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !SIGNED_CREDENTIAL_PATTERN.test(value.credential) ||
      value.credential.length > 1_024 ||
      !Number.isSafeInteger(value.expires_at_ms) ||
      value.expires_at_ms <= Date.now()
    ) {
      window.sessionStorage.removeItem(RECOVERY_CREDENTIAL_KEY);
      return "";
    }
    return value.credential;
  } catch {
    return "";
  }
}

function persistRecoveryCredential(
  credential,
  expiresInMs = RECOVERY_CLIENT_TTL_MS,
  { force = false } = {},
) {
  if (!SIGNED_CREDENTIAL_PATTERN.test(credential) || credential.length > 1_024) {
    return false;
  }
  try {
    if (!force) {
      const existingRaw = window.sessionStorage.getItem(RECOVERY_CREDENTIAL_KEY);
      if (existingRaw) {
        const existing = JSON.parse(existingRaw);
        if (
          existing !== null &&
          typeof existing === "object" &&
          SIGNED_CREDENTIAL_PATTERN.test(existing.credential) &&
          Number.isSafeInteger(existing.expires_at_ms) &&
          existing.expires_at_ms - Date.now() > RECOVERY_REFRESH_THRESHOLD_MS
        ) {
          return false;
        }
      }
    }
    window.sessionStorage.setItem(RECOVERY_CREDENTIAL_KEY, JSON.stringify({
      credential,
      expires_at_ms: Date.now() + Math.min(expiresInMs, RECOVERY_CLIENT_TTL_MS),
    }));
    return true;
  } catch {
    // A valid live view remains usable when origin storage is unavailable.
    return false;
  }
}

function storeRecoveryCredential(response) {
  const credential = response.headers?.get(RECOVERY_HEADER) || "";
  persistRecoveryCredential(credential);
  return credential;
}

function refreshRecoveredAccess(response, stateAccessCredential, recoveryCredential) {
  const credential = response.headers?.get(ACCESS_HEADER) || "";
  if (SIGNED_CREDENTIAL_PATTERN.test(credential) && credential.length <= 1_024) {
    recoveredAccessToken = credential;
    if (
      stateAccessCredential === accessToken &&
      VIEWER_TOKEN_PATTERN.test(accessToken) &&
      SIGNED_CREDENTIAL_PATTERN.test(recoveryCredential) &&
      recoveryCredential.length <= 1_024
    ) {
      accessToken = "";
      try {
        window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
        window.sessionStorage.removeItem(EXCLUDED_SESSION_KEY);
      } catch {
        // The signed credentials remain usable when storage is unavailable.
      }
    }
  }
}

function clearRejectedViewerToken() {
  accessToken = "";
  recoveredAccessToken = "";
  try {
    window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

function clearRecoveryCredential() {
  try {
    window.sessionStorage.removeItem(RECOVERY_CREDENTIAL_KEY);
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

function validateExchangePayload(payload) {
  return Boolean(
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Object.keys(payload).sort().join(",") ===
      "access_credential,access_expires_in_ms,excluded_session_id,recovery_credential,recovery_expires_in_ms,status" &&
    payload.status === "exchanged" &&
    SIGNED_CREDENTIAL_PATTERN.test(payload.access_credential) &&
    payload.access_credential.length <= 1_024 &&
    Number.isSafeInteger(payload.access_expires_in_ms) &&
    payload.access_expires_in_ms > 0 &&
    payload.access_expires_in_ms <= ACCESS_CLIENT_TTL_MS &&
    SIGNED_CREDENTIAL_PATTERN.test(payload.recovery_credential) &&
    payload.recovery_credential.length <= 1_024 &&
    Number.isSafeInteger(payload.recovery_expires_in_ms) &&
    payload.recovery_expires_in_ms > 0 &&
    payload.recovery_expires_in_ms <= RECOVERY_CLIENT_TTL_MS &&
    (
      payload.excluded_session_id === null ||
      (
        typeof payload.excluded_session_id === "string" &&
        CANONICAL_SESSION_ID_PATTERN.test(payload.excluded_session_id)
      )
    )
  );
}

async function exchangeViewerCredential(credential, { source }) {
  if (
    authenticationExchangeInFlight ||
    !SIGNED_CREDENTIAL_PATTERN.test(credential) ||
    credential.length > 1_024
  ) {
    return false;
  }

  authenticationExchangeInFlight = true;
  try {
    const response = await fetch(API_EXCHANGE_URL, {
      body: JSON.stringify({ credential }),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (
        (response.status === 401 || response.status === 403 || response.status === 409)
      ) {
        if (source === "recovery") {
          clearRecoveryCredential();
        } else if (source === "bootstrap") {
          bootstrapCredential = "";
        }
      }
      throw new Error(t("requestFailed", { status: response.status }));
    }

    const payload = await response.json();
    if (!validateExchangePayload(payload)) {
      throw new Error(t("invalidState"));
    }

    recoveredAccessToken = payload.access_credential;
    if (source === "bootstrap") {
      bootstrapCredential = "";
    }
    excludedSessionId = payload.excluded_session_id || "";
    persistRecoveryCredential(
      payload.recovery_credential,
      payload.recovery_expires_in_ms,
      { force: true },
    );
    return true;
  } finally {
    authenticationExchangeInFlight = false;
  }
}

const elements = Object.freeze({
  connectionStatus: document.querySelector("#connection-status"),
  connectionLabel: document.querySelector("#connection-label"),
  language: document.querySelector("#language-select"),
  metaDescription: document.querySelector("#meta-description"),
  lastUpdated: document.querySelector("#last-updated"),
  metricSessions: document.querySelector("#metric-sessions"),
  metricRunning: document.querySelector("#metric-running"),
  metricWaiting: document.querySelector("#metric-waiting"),
  metricCompleted: document.querySelector("#metric-completed"),
  search: document.querySelector("#session-search"),
  statusFilter: document.querySelector("#status-filter"),
  toolbar: document.querySelector(".toolbar"),
  resultsSummary: document.querySelector("#results-summary"),
  stateMessage: document.querySelector("#state-message"),
  sessionList: document.querySelector("#session-list"),
});

function applyStaticTranslations() {
  document.documentElement.lang = currentLanguage;
  elements.language.value = currentLanguage;
  elements.metaDescription.content = t("metaDescription");
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  }
}

function setLanguage(value) {
  currentLanguage = SUPPORTED_LANGUAGES.has(value) ? value : "zh-TW";
  try {
    window.localStorage.setItem(LANGUAGE_KEY, currentLanguage);
  } catch {
    // The selected language still applies for this page load.
  }
  applyStaticTranslations();
  setConnectionStatus(
    elements.connectionStatus.dataset.status,
    viewState.authenticationFailed ? t("authenticationRequired") : "",
  );
  render();
}

const viewState = {
  updatedAtMs: null,
  sessions: [],
  diagnostics: [],
  hasLoaded: false,
  errorMessage: "",
  errorKey: "",
  canRetry: true,
  authenticationFailed: false,
  requestInFlight: false,
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeSummary(value) {
  return safeString(value, "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function sanitizedFallbackLabel(value, fallback) {
  const normalized = safeString(value, "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);

  if (!normalized) {
    return fallback;
  }

  return normalized.replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

function normalizedLookupKey(value) {
  return safeString(value, "").replace(/[^a-zA-Z0-9_]/g, "").toLocaleLowerCase();
}

function formatAgentRole(agentType) {
  const key = normalizedLookupKey(agentType);
  return AGENT_ROLE_KEYS[key]
    ? t(AGENT_ROLE_KEYS[key])
    : sanitizedFallbackLabel(agentType, t("roleUnknown"));
}

function formatToolLabel(toolName) {
  const key = normalizedLookupKey(toolName);
  return TOOL_KEYS[key]
    ? t(TOOL_KEYS[key])
    : t("toolFallback", { name: sanitizedFallbackLabel(toolName, t("nameUnknown")) });
}

function formatActivityLabel(activity) {
  if (activity.eventName === "subagent_started" && activity.agentOrdinal !== null) {
    return t("agentStarted", { ordinal: activity.agentOrdinal });
  }
  if (activity.eventName === "subagent_stopped" && activity.agentOrdinal !== null) {
    return t("agentStopped", { ordinal: activity.agentOrdinal });
  }
  if (activity.eventName === "permission_requested" && activity.toolName) {
    return t("approvalRequest", { tool: formatToolLabel(activity.toolName) });
  }
  if (
    (activity.eventName === "tool_started" || activity.eventName === "tool_completed") &&
    activity.toolName
  ) {
    return formatToolLabel(activity.toolName);
  }
  return ACTIVITY_KEYS[activity.eventName]
    ? t(ACTIVITY_KEYS[activity.eventName])
    : t("activityFallback", {
      name: sanitizedFallbackLabel(activity.eventName, t("activityUnknown")),
    });
}

function formatAgentCurrentActivity(agent) {
  if (agent.status === "completed") {
    if (
      agent.currentToolStatus === "completion_not_observed" ||
      agent.currentToolStatus === "interrupted"
    ) {
      return t("agentLastActivityCompletionUnconfirmed");
    }
    return t("agentWorkEnded");
  }

  const lifecycleExplanationKey = STATUS_EXPLANATION_KEYS[agent.status];
  if (lifecycleExplanationKey) {
    return t(lifecycleExplanationKey);
  }
  if (agent.status === "unknown") {
    return t("agentCurrentStatusUnverified");
  }

  if (agent.currentToolName && agent.currentToolStatus === "running") {
    const tool = formatToolLabel(agent.currentToolName);
    return agent.currentToolObservedAtMs === null
      ? t("agentToolRunning", { tool })
      : t("agentToolRunningObserved", {
        tool,
        time: formatRelativeTime(agent.currentToolObservedAtMs),
      });
  }

  if (
    agent.status === "running" &&
    agent.currentToolName &&
    agent.currentToolStatus === "completed"
  ) {
    const tool = formatToolLabel(agent.currentToolName);
    return agent.currentToolObservedAtMs === null
      ? t("agentToolCompletedRecently", { tool })
      : t("agentToolCompletedRecentlyObserved", {
        tool,
        time: formatRelativeTime(agent.currentToolObservedAtMs),
      });
  }

  if (agent.status === "waiting") {
    return t("agentWaitingForNextStep");
  }

  return t("agentCurrentActivityUnavailable");
}

function safeTimestamp(value) {
  return Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000
    ? value
    : null;
}

function normalizeStatus(value) {
  return typeof value === "string" && KNOWN_STATUSES.has(value) ? value : "unknown";
}

function normalizeCoreStatus(value) {
  if (value === "running") {
    return "running";
  }
  if (value === "waiting" || value === "waiting_for_user") {
    return "waiting";
  }
  if (
    value === "completed" ||
    value === "stopped" ||
    value === "stopped_without_start" ||
    value === "completed_without_start" ||
    value === "late_start_observed"
  ) {
    return "completed";
  }
  if (value === "completion_not_observed" || value === "stale" || value === "interrupted") {
    return value;
  }
  return normalizeStatus(value);
}

function normalizeAgent(value, index) {
  const agent = isRecord(value) ? value : {};
  return {
    agentId: safeString(agent.agent_id, `unknown-agent-${index + 1}`),
    agentType: safeString(agent.agent_type, "unknown"),
    assignmentSummary: safeSummary(agent.assignment_summary),
    currentToolName: safeSummary(agent.current_tool_name),
    currentToolStatus: normalizeCoreStatus(agent.current_tool_status),
    currentToolObservedAtMs: safeTimestamp(agent.current_tool_observed_at_ms),
    status: normalizeCoreStatus(agent.status),
    startedAtMs: safeTimestamp(agent.started_at_ms),
    stoppedAtMs: safeTimestamp(agent.stopped_at_ms),
    lastActivityAtMs: safeTimestamp(agent.last_seen_at_ms),
  };
}

function agentOrderTimestamp(agent) {
  return agent.startedAtMs ?? agent.stoppedAtMs ?? agent.lastActivityAtMs ?? Number.MAX_SAFE_INTEGER;
}

function assignStableAgentOrdinals(agents) {
  const ordinalByAgentId = new Map(
    [...agents]
      .sort((left, right) => (
        agentOrderTimestamp(left) - agentOrderTimestamp(right) ||
        left.agentId.localeCompare(right.agentId)
      ))
      .map((agent, index) => [agent.agentId, index + 1]),
  );

  return agents.map((agent) => ({
    ...agent,
    ordinal: ordinalByAgentId.get(agent.agentId),
  }));
}

function normalizeActivity(value) {
  const activity = isRecord(value) ? value : {};
  return {
    eventName: safeString(activity.type, "unknown_event"),
    agentId: safeString(activity.agent_id, ""),
    agentOrdinal: null,
    toolName: safeString(activity.tool_name, ""),
    toolUseId: safeString(activity.tool_use_id, ""),
    status: normalizeCoreStatus(activity.status),
    occurredAtMs: safeTimestamp(activity.received_at_ms),
  };
}

function isToolLifecycle(activity) {
  return activity.eventName === "tool_started" || activity.eventName === "tool_completed";
}

function shouldReplaceToolActivity(candidate, current) {
  const candidateTime = candidate.occurredAtMs ?? -1;
  const currentTime = current.occurredAtMs ?? -1;
  if (candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }
  return candidate.eventName === "tool_completed" && current.eventName !== "tool_completed";
}

function collapseToolActivities(activities) {
  const latestByToolUseId = new Map();

  for (const activity of activities) {
    if (!activity.toolUseId || !isToolLifecycle(activity)) {
      continue;
    }
    const current = latestByToolUseId.get(activity.toolUseId);
    if (!current || shouldReplaceToolActivity(activity, current)) {
      latestByToolUseId.set(activity.toolUseId, activity);
    }
  }

  return activities.filter((activity) => (
    !activity.toolUseId ||
    !isToolLifecycle(activity) ||
    latestByToolUseId.get(activity.toolUseId) === activity
  ));
}

function normalizeDiagnostic(value) {
  const diagnostic = isRecord(value) ? value : {};
  return {
    code: safeString(diagnostic.code, "unknown_diagnostic"),
    diagnosedAtMs: safeTimestamp(diagnostic.diagnosed_at_ms),
  };
}

function deriveSessionStatus(session, agents, recentActivities) {
  const reportedStatus = normalizeCoreStatus(session.status);
  if (reportedStatus !== "unknown") {
    return reportedStatus;
  }
  if (session.permission?.status === "waiting_for_user") {
    return "waiting";
  }
  if (
    agents.some((agent) => agent.status === "running") ||
    recentActivities[0]?.status === "running"
  ) {
    return "running";
  }
  return "unknown";
}

function normalizeSession(value, index) {
  const session = isRecord(value) ? value : {};
  const agents = Array.isArray(session.agents)
    ? assignStableAgentOrdinals(session.agents.map(normalizeAgent))
    : [];
  const agentOrdinalById = new Map(
    agents.map((agent) => [agent.agentId, agent.ordinal]),
  );
  const recentActivities = Array.isArray(session.recent_activities)
    ? collapseToolActivities(session.recent_activities.map(normalizeActivity)).map(
      (activity) => ({
        ...activity,
        agentOrdinal: agentOrdinalById.get(activity.agentId) ?? null,
      }),
    )
    : [];

  return {
    sessionId: safeString(session.session_id, `unknown-session-${index + 1}`),
    workspaceLabel: safeString(session.workspace_label, ""),
    taskSummary: safeString(session.task_summary, ""),
    status: deriveSessionStatus(session, agents, recentActivities),
    lastActivityAtMs: safeTimestamp(session.last_seen_at_ms),
    agents,
    recentActivities,
  };
}

function normalizeState(value) {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    value.source_of_truth !== "hook" ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.diagnostics)
  ) {
    throw new TypeError(t("invalidState"));
  }

  return {
    updatedAtMs: safeTimestamp(value.updated_at_ms),
    sessions: value.sessions.map(normalizeSession),
    diagnostics: value.diagnostics.map(normalizeDiagnostic),
  };
}

function compareByActivity(left, right) {
  return (right.lastActivityAtMs ?? -1) - (left.lastActivityAtMs ?? -1);
}

function compareAgents(left, right) {
  const statusDifference = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
  return statusDifference || compareByActivity(left, right);
}

function compareSessions(left, right) {
  const statusDifference = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
  return statusDifference || compareByActivity(left, right);
}

function formatDateTime(timestampMs) {
  if (timestampMs === null) {
    return t("timeUnknown");
  }

  return new Intl.DateTimeFormat(currentLanguage, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestampMs));
}

function formatRelativeTime(timestampMs) {
  if (timestampMs === null) {
    return t("timeUnknown");
  }

  const differenceSeconds = Math.round((timestampMs - Date.now()) / 1_000);
  const absoluteSeconds = Math.abs(differenceSeconds);
  const formatter = new Intl.RelativeTimeFormat(currentLanguage, { numeric: "auto" });

  if (absoluteSeconds < 60) {
    return formatter.format(differenceSeconds, "second");
  }
  if (absoluteSeconds < 3_600) {
    return formatter.format(Math.round(differenceSeconds / 60), "minute");
  }
  if (absoluteSeconds < 86_400) {
    return formatter.format(Math.round(differenceSeconds / 3_600), "hour");
  }
  return formatter.format(Math.round(differenceSeconds / 86_400), "day");
}

function formatDuration(startedAtMs, stoppedAtMs) {
  if (startedAtMs === null) {
    return t("startedUnknown");
  }

  const endAtMs = stoppedAtMs ?? Date.now();
  const seconds = Math.max(0, Math.floor((endAtMs - startedAtMs) / 1_000));
  if (seconds < 60) {
    return t("durationSeconds", { count: seconds });
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t("durationMinutes", { count: minutes });
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? t("durationHoursMinutes", { hours, minutes: remainingMinutes })
    : t("durationHours", { count: hours });
}

function createStatusBadge(status) {
  const badge = document.createElement("span");
  badge.className = "status-badge";
  badge.dataset.status = status;

  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.textContent = t(STATUS_KEYS[status] ?? "statusUnknown");

  badge.append(dot, label);
  return badge;
}

function createStatusExplanation(status) {
  const messageKey = STATUS_EXPLANATION_KEYS[status];
  if (!messageKey) {
    return null;
  }

  const explanation = document.createElement("p");
  explanation.className = "status-explanation";
  explanation.textContent = t(messageKey);
  return explanation;
}

function createTime(timestampMs, prefix) {
  const wrapper = document.createElement("span");
  wrapper.className = "time-label";

  if (prefix) {
    wrapper.append(`${prefix} `);
  }

  if (timestampMs === null) {
    wrapper.append(t("timeUnknown"));
    return wrapper;
  }

  const time = document.createElement("time");
  time.dateTime = new Date(timestampMs).toISOString();
  time.title = formatDateTime(timestampMs);
  time.textContent = formatRelativeTime(timestampMs);
  wrapper.append(time);
  return wrapper;
}

function createTechnicalInfo(rows) {
  const info = document.createElement("div");
  info.className = "technical-info";

  const heading = document.createElement("p");
  heading.className = "technical-info-title";
  heading.textContent = t("technicalInfo");
  const list = document.createElement("dl");

  for (const [label, value] of rows) {
    if (!value) {
      continue;
    }
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    const code = document.createElement("code");
    code.textContent = value;
    description.append(code);
    list.append(term, description);
  }

  info.append(heading, list);
  return info;
}

function createAgentItem(agent) {
  const item = document.createElement("li");
  item.className = "agent-item";
  item.dataset.status = agent.status;

  const heading = document.createElement("div");
  heading.className = "agent-heading";

  const identity = document.createElement("div");
  identity.className = "agent-identity";
  const name = document.createElement("strong");
  name.className = "agent-name";
  name.textContent = t("subagentName", { ordinal: agent.ordinal });
  identity.append(name);

  const roleLabel = formatAgentRole(agent.agentType);
  const role = document.createElement("span");
  role.className = "agent-role";
  role.textContent = t("agentProfile", { profile: roleLabel });
  identity.append(role);
  heading.append(identity, createStatusBadge(agent.status));

  const metadata = document.createElement("div");
  metadata.className = "agent-metadata";
  metadata.append(
    createTime(agent.lastActivityAtMs, t("recent")),
    document.createTextNode(` · ${formatDuration(agent.startedAtMs, agent.stoppedAtMs)}`),
  );

  const statusExplanation = createStatusExplanation(agent.status);

  const workSummary = document.createElement("dl");
  workSummary.className = "agent-work-summary";
  const summaryRows = [
    [t("agentAssignment"), agent.assignmentSummary || t("agentAssignmentUnavailable")],
    [t("agentCurrentActivity"), formatAgentCurrentActivity(agent)],
  ];
  for (const [label, value] of summaryRows) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    row.append(term, description);
    workSummary.append(row);
  }

  const technicalRows = [[t("agentId"), agent.agentId]];
  technicalRows.push([t("rawProfile"), agent.agentType]);

  item.append(heading, workSummary, metadata);
  if (statusExplanation) {
    item.append(statusExplanation);
  }
  item.append(createTechnicalInfo(technicalRows));
  return item;
}

function createActivityItem(activity) {
  const item = document.createElement("li");
  item.className = "activity-item";

  const marker = document.createElement("span");
  marker.className = "activity-marker";
  marker.dataset.status = activity.status;
  marker.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  const title = document.createElement("div");
  title.className = "activity-title";
  const eventName = document.createElement("strong");
  eventName.textContent = formatActivityLabel(activity);
  title.append(eventName);

  const metadata = document.createElement("div");
  metadata.className = "activity-metadata";
  metadata.append(createStatusBadge(activity.status), createTime(activity.occurredAtMs, ""));

  const technicalRows = [[t("rawEvent"), activity.eventName]];
  if (activity.toolName) {
    technicalRows.push([t("rawTool"), activity.toolName]);
  }

  content.append(title, metadata, createTechnicalInfo(technicalRows));
  item.append(marker, content);
  return item;
}

function createEmptyPanel(message) {
  const empty = document.createElement("p");
  empty.className = "panel-empty";
  empty.textContent = message;
  return empty;
}

function createSessionCard(session) {
  const listItem = document.createElement("li");
  const article = document.createElement("article");
  article.className = "session-card";
  article.dataset.status = session.status;

  const cardHeader = document.createElement("header");
  cardHeader.className = "session-header";

  const identity = document.createElement("div");
  identity.className = "session-identity";
  const eyebrow = document.createElement("span");
  eyebrow.className = "session-kind";
  eyebrow.textContent = t("parentTask");
  const title = document.createElement("h3");
  title.textContent = session.workspaceLabel || t("projectUnknown");
  const taskSummary = document.createElement("p");
  taskSummary.className = "task-summary";
  const taskSummaryLabel = document.createElement("strong");
  taskSummaryLabel.textContent = `${t("taskSummary")} · `;
  const taskSummaryCopy = document.createElement("span");
  taskSummaryCopy.textContent = session.taskSummary || t("taskSummaryUnavailable");
  taskSummary.append(taskSummaryLabel, taskSummaryCopy);
  identity.append(eyebrow, title, taskSummary);

  const sessionState = document.createElement("div");
  sessionState.className = "session-state";
  sessionState.append(
    createStatusBadge(session.status),
    createTime(session.lastActivityAtMs, t("recentActivity")),
  );
  const statusExplanation = createStatusExplanation(session.status);
  if (statusExplanation) {
    sessionState.append(statusExplanation);
  }

  cardHeader.append(identity, sessionState);

  const panels = document.createElement("div");
  panels.className = "session-panels";

  const agentPanel = document.createElement("section");
  agentPanel.className = "session-panel";
  const agentTitle = document.createElement("h4");
  agentTitle.textContent = t("subagentsCount", { count: session.agents.length });
  const profileNote = document.createElement("p");
  profileNote.className = "agent-profile-note";
  profileNote.textContent = t("agentProfileNote");
  agentPanel.append(agentTitle, profileNote);

  if (session.agents.length) {
    const list = document.createElement("ul");
    list.className = "agent-list";
    [...session.agents].sort(compareAgents).forEach((agent) => {
      list.append(createAgentItem(agent));
    });
    agentPanel.append(list);
  } else {
    agentPanel.append(createEmptyPanel(t("noSubagents")));
  }

  const activityPanel = document.createElement("section");
  activityPanel.className = "session-panel";
  const activityTitle = document.createElement("h4");
  activityTitle.textContent = t("recentActivity");
  activityPanel.append(activityTitle);

  if (session.recentActivities.length) {
    const list = document.createElement("ol");
    list.className = "activity-list";
    session.recentActivities.slice(0, 6).forEach((activity) => {
      list.append(createActivityItem(activity));
    });
    activityPanel.append(list);
  } else {
    activityPanel.append(createEmptyPanel(t("noRecentActivity")));
  }

  panels.append(agentPanel, activityPanel);
  article.append(cardHeader, panels);
  listItem.append(article);
  return listItem;
}

function sessionMatchesQuery(session, query) {
  if (!query) {
    return true;
  }

  const searchableValues = [
    session.sessionId,
    session.workspaceLabel,
    session.taskSummary,
    session.status,
    ...session.agents.flatMap((agent) => [
      agent.agentId,
      formatAgentRole(agent.agentType),
      agent.assignmentSummary,
      formatAgentCurrentActivity(agent),
      agent.status,
    ]),
    ...session.recentActivities.flatMap((activity) => [
      activity.eventName,
      activity.toolName,
      activity.status,
    ]),
  ];

  return searchableValues.some((value) => value.toLocaleLowerCase().includes(query));
}

function sessionMatchesStatus(session, status) {
  return (
    status === "all" ||
    session.status === status ||
    (status === "completion_not_observed" && session.status === "stale")
  );
}

function observableSessions() {
  return viewState.sessions.filter((session) => session.sessionId !== excludedSessionId);
}

function filteredSessions() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const status = elements.statusFilter.value;

  return observableSessions()
    .filter((session) => sessionMatchesQuery(session, query))
    .filter((session) => sessionMatchesStatus(session, status))
    .sort(compareSessions);
}

function renderMetrics() {
  const sessions = observableSessions();
  const agents = sessions.flatMap((session) => session.agents);
  const countStatus = (status) => agents.filter((agent) => agent.status === status).length;

  elements.metricSessions.textContent = String(sessions.length);
  elements.metricRunning.textContent = String(countStatus("running"));
  const waitingCount = countStatus("waiting") + sessions.filter(
    (session) => session.status === "waiting",
  ).length;
  elements.metricWaiting.textContent = String(waitingCount);
  elements.metricCompleted.textContent = String(countStatus("completed"));
  elements.lastUpdated.textContent = !viewState.updatedAtMs
    ? t("noReceivedActivity")
    : formatDateTime(viewState.updatedAtMs);
}

function setStateMessage(kind, title, description, retryMode = "") {
  elements.stateMessage.className = `state-message state-${kind}`;
  elements.stateMessage.replaceChildren();

  const heading = document.createElement("strong");
  heading.textContent = title;
  const copy = document.createElement("span");
  copy.textContent = description;
  elements.stateMessage.append(heading, copy);

  const recoveryAvailable = retryMode === "authentication" && Boolean(
    accessToken || recoveredAccessToken || bootstrapCredential || readRecoveryCredential(),
  );

  if (retryMode === "authentication") {
    const recovery = document.createElement("div");
    recovery.className = "recovery-guidance";

    const recoveryTitle = document.createElement("strong");
    recoveryTitle.textContent = t(
      recoveryAvailable ? "recoveryAvailableTitle" : "recoveryTitle",
    );
    const recoveryStep = document.createElement("p");
    recoveryStep.textContent = t(
      recoveryAvailable ? "recoveryAvailableStep" : "recoveryStep",
    );
    const recoveryNote = document.createElement("p");
    recoveryNote.className = "recovery-note";
    recoveryNote.textContent = t(
      recoveryAvailable ? "recoveryAvailableNote" : "recoveryNote",
    );
    recovery.append(recoveryTitle, recoveryStep, recoveryNote);
    elements.stateMessage.append(recovery);
  }

  if (retryMode && (retryMode !== "authentication" || recoveryAvailable)) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry-button";
    retry.textContent = retryMode === "authentication"
      ? (accessToken ? t("retryAuthentication") : t("reconnectAuthentication"))
      : t("retry");
    retry.addEventListener(
      "click",
      retryMode === "authentication" ? retryAuthentication : refreshState,
    );
    elements.stateMessage.append(retry);
  }
}

async function retryAuthentication() {
  const refreshedContext = consumeLiveContext();
  if (refreshedContext.accessToken) {
    accessToken = refreshedContext.accessToken;
    excludedSessionId = refreshedContext.excludedSessionId;
  }
  if (refreshedContext.bootstrapCredential) {
    bootstrapCredential = refreshedContext.bootstrapCredential;
  }

  if (accessToken) {
    viewState.authenticationFailed = false;
    viewState.canRetry = true;
    viewState.errorKey = "";
    viewState.errorMessage = "";
    setConnectionStatus("connecting");
    render();
    await refreshState();
    return;
  }

  const credential = bootstrapCredential || readRecoveryCredential();
  const source = bootstrapCredential ? "bootstrap" : "recovery";
  if (!credential) {
    viewState.hasLoaded = true;
    viewState.canRetry = false;
    viewState.authenticationFailed = true;
    viewState.errorKey = "missingToken";
    viewState.errorMessage = t(viewState.errorKey);
    setConnectionStatus("error", t("authenticationRequired"));
    render();
    return;
  }

  viewState.authenticationFailed = false;
  viewState.canRetry = false;
  viewState.errorKey = "";
  viewState.errorMessage = "";
  setConnectionStatus("connecting");
  render();

  try {
    const exchanged = await exchangeViewerCredential(credential, { source });
    if (!exchanged) return;
    viewState.canRetry = true;
    await refreshState();
  } catch (error) {
    viewState.hasLoaded = true;
    viewState.canRetry = false;
    viewState.authenticationFailed = true;
    viewState.errorKey = "expiredToken";
    viewState.errorMessage = error instanceof Error
      ? error.message
      : t("unknownConnectionError");
    setConnectionStatus("error", t("authenticationRequired"));
    render();
  }
}

function setEmptyObservationMessage() {
  elements.stateMessage.className = "state-message state-empty state-empty-observation";
  elements.stateMessage.replaceChildren();

  const rawSessions = Array.isArray(viewState.sessions) ? viewState.sessions : [];
  const hasOnlyExcludedViewerTask =
    rawSessions.length > 0 &&
    observableSessions().length === 0 &&
    CANONICAL_SESSION_ID_PATTERN.test(excludedSessionId) &&
    rawSessions.some((session) => session.sessionId === excludedSessionId);
  const noHookEventsObserved =
    viewState.diagnostics.length === 0 &&
    rawSessions.length === 0 &&
    (!Number.isFinite(viewState.updatedAtMs) || viewState.updatedAtMs <= 0);

  const heading = document.createElement("strong");
  const copy = document.createElement("span");

  if (viewState.diagnostics.length) {
    heading.textContent = t("emptyWithDiagnosticsTitle");
    copy.textContent = t("emptyWithDiagnosticsCopy", { count: viewState.diagnostics.length });
  } else if (hasOnlyExcludedViewerTask) {
    heading.textContent = t("viewerTaskHiddenTitle");
    copy.textContent = t("viewerTaskHiddenCopy");
  } else {
    heading.textContent = t("emptyTitle");
    copy.textContent = t("emptyCopy");
  }

  const guidance = document.createElement("div");
  guidance.className = "empty-guidance";

  const guidanceTitle = document.createElement("h3");
  guidanceTitle.textContent = t("emptyGuidanceTitle");

  const automaticTracking = document.createElement("p");
  automaticTracking.className = "automatic-tracking";
  automaticTracking.textContent = t("automaticTracking");

  const boundary = document.createElement("p");
  boundary.className = "observation-boundary";
  boundary.textContent = t("observationBoundary");

  guidance.append(guidanceTitle);
  if (hasOnlyExcludedViewerTask) {
    const viewerTaskCallout = document.createElement("section");
    viewerTaskCallout.className = "viewer-task-callout";
    const viewerTaskTitle = document.createElement("h4");
    viewerTaskTitle.textContent = t("viewerTaskActionTitle");
    const viewerTaskCopy = document.createElement("p");
    viewerTaskCopy.textContent = t("viewerTaskExclusion");
    viewerTaskCallout.append(viewerTaskTitle, viewerTaskCopy);
    guidance.append(viewerTaskCallout);
  } else if (noHookEventsObserved) {
    const hookReview = document.createElement("section");
    hookReview.className = "hook-review-callout";
    const hookReviewTitle = document.createElement("h4");
    hookReviewTitle.textContent = t("hookReviewTitle");
    const hookReviewCopy = document.createElement("p");
    hookReviewCopy.textContent = t("hookReviewCopy");
    hookReview.append(hookReviewTitle, hookReviewCopy);

    const steps = document.createElement("ol");
    for (const step of [
      t("emptyStep1"),
      t("emptyStep2"),
      t("emptyStep3"),
      t("emptyStep4"),
    ]) {
      const item = document.createElement("li");
      item.textContent = step;
      steps.append(item);
    }
    guidance.append(hookReview, automaticTracking, steps);
  } else {
    guidance.append(automaticTracking);
  }
  guidance.append(boundary);

  if (viewState.diagnostics.length) {
    const diagnostics = document.createElement("div");
    diagnostics.className = "diagnostic-info";
    const diagnosticsTitle = document.createElement("p");
    diagnosticsTitle.className = "diagnostic-info-title";
    diagnosticsTitle.textContent = t("diagnosticsCount", { count: viewState.diagnostics.length });
    const codes = document.createElement("ul");
    const diagnosticCounts = new Map();
    for (const { code } of viewState.diagnostics) {
      diagnosticCounts.set(code, (diagnosticCounts.get(code) ?? 0) + 1);
    }
    for (const [diagnosticCode, count] of diagnosticCounts) {
      const item = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = diagnosticCode;
      item.append(code, ` · ${t("diagnosticOccurrences", { count })}`);
      codes.append(item);
    }
    diagnostics.append(diagnosticsTitle, codes);
    guidance.append(diagnostics);
  }

  elements.stateMessage.append(heading, copy, guidance);
}

function renderSessions() {
  const sessions = observableSessions();
  const visibleSessions = filteredSessions();
  const hasFilters = elements.search.value.trim() || elements.statusFilter.value !== "all";

  elements.toolbar.hidden = sessions.length === 0;
  elements.stateMessage.hidden = false;

  elements.sessionList.replaceChildren();
  visibleSessions.forEach((session) => {
    elements.sessionList.append(createSessionCard(session));
  });

  elements.resultsSummary.textContent = hasFilters
    ? t("resultsFiltered", { total: sessions.length, visible: visibleSessions.length })
    : t("resultsTotal", { count: sessions.length });

  if (!viewState.hasLoaded) {
    elements.sessionList.hidden = true;
    setStateMessage("loading", t("loadingState"), t("connectingCopy"));
    return;
  }

  if (viewState.errorMessage) {
    elements.sessionList.hidden = !visibleSessions.length;
    const description = viewState.canRetry
      ? sessions.length
        ? t("retryWithState")
        : t("retryWithoutState")
      : viewState.errorKey ? t(viewState.errorKey) : viewState.errorMessage;
    setStateMessage(
      "error",
      viewState.canRetry
        ? t("disconnectedTitle")
        : t("authTitle"),
      description,
      viewState.canRetry ? "connection" : "authentication",
    );
    return;
  }

  if (!sessions.length) {
    elements.sessionList.hidden = true;
    setEmptyObservationMessage();
    return;
  }

  if (!visibleSessions.length) {
    elements.sessionList.hidden = true;
    setStateMessage(
      "empty",
      t("searchEmptyTitle"),
      t("searchEmptyCopy"),
    );
    return;
  }

  elements.stateMessage.hidden = true;
  elements.sessionList.hidden = false;
}

function render() {
  elements.stateMessage.hidden = false;
  renderMetrics();
  renderSessions();
}

function setConnectionStatus(status, labelOverride = "") {
  elements.connectionStatus.dataset.status = status;
  const labels = {
    connecting: t("connectionConnecting"),
    connected: t("connectionConnected"),
    error: t("connectionRetrying"),
  };
  elements.connectionLabel.textContent = labelOverride || labels[status];
}

async function refreshState() {
  if (viewState.requestInFlight || viewState.authenticationFailed) {
    return;
  }

  const stateAccessCredential = accessToken || recoveredAccessToken;
  if (!stateAccessCredential) {
    viewState.hasLoaded = true;
    viewState.canRetry = false;
    viewState.authenticationFailed = true;
    viewState.errorKey = "missingToken";
    viewState.errorMessage = t(viewState.errorKey);
    setConnectionStatus("error", t("authenticationRequired"));
    render();
    return;
  }

  viewState.requestInFlight = true;
  if (!viewState.hasLoaded) {
    setConnectionStatus("connecting");
  }

  try {
    const stateHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${stateAccessCredential}`,
    };
    if (
      stateAccessCredential === accessToken &&
      VIEWER_TOKEN_PATTERN.test(accessToken) &&
      CANONICAL_SESSION_ID_PATTERN.test(excludedSessionId)
    ) {
      stateHeaders["x-codex-agent-view-exclude-session"] = excludedSessionId;
    }
    const response = await fetch(API_STATE_URL, {
      cache: "no-store",
      credentials: "same-origin",
      headers: stateHeaders,
    });

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      clearRejectedViewerToken();
      viewState.hasLoaded = true;
      viewState.canRetry = false;
      viewState.authenticationFailed = true;
      viewState.errorKey = "expiredToken";
      viewState.errorMessage = t(viewState.errorKey);
      setConnectionStatus("error", t("authenticationRequired"));
      return;
    }

    if (!response.ok) {
      throw new Error(t("requestFailed", { status: response.status }));
    }

    const recoveryCredential = storeRecoveryCredential(response);
    refreshRecoveredAccess(response, stateAccessCredential, recoveryCredential);
    const nextState = normalizeState(await response.json());
    viewState.updatedAtMs = nextState.updatedAtMs;
    viewState.sessions = nextState.sessions;
    viewState.diagnostics = nextState.diagnostics;
    viewState.hasLoaded = true;
    viewState.errorMessage = "";
    viewState.errorKey = "";
    viewState.canRetry = true;
    setConnectionStatus("connected");
  } catch (error) {
    viewState.hasLoaded = true;
    viewState.canRetry = true;
    viewState.errorMessage = error instanceof Error
      ? error.message
      : t("unknownConnectionError");
    viewState.errorKey = "";
    setConnectionStatus("error");
  } finally {
    viewState.requestInFlight = false;
    render();
  }
}

elements.search.addEventListener("input", renderSessions);
elements.statusFilter.addEventListener("change", renderSessions);
elements.language.addEventListener("change", (event) => setLanguage(event.target.value));
elements.toolbar.addEventListener("submit", (event) => {
  event.preventDefault();
});
window.addEventListener("online", refreshState);
window.addEventListener("offline", () => {
  if (viewState.authenticationFailed) {
    return;
  }
  viewState.canRetry = true;
  viewState.errorMessage = t("offline");
  viewState.errorKey = "offline";
  setConnectionStatus("error");
  render();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshState();
  }
});

async function initializeLiveView() {
  applyStaticTranslations();
  render();

  if (bootstrapCredential) {
    viewState.authenticationFailed = false;
    setConnectionStatus("connecting");
    try {
      const exchanged = await exchangeViewerCredential(bootstrapCredential, {
        source: "bootstrap",
      });
      if (exchanged) {
        await refreshState();
      }
    } catch (error) {
      viewState.hasLoaded = true;
      viewState.canRetry = false;
      viewState.authenticationFailed = true;
      viewState.errorKey = "expiredToken";
      viewState.errorMessage = error instanceof Error
        ? error.message
        : t("unknownConnectionError");
      setConnectionStatus("error", t("authenticationRequired"));
      render();
    }
  } else {
    await refreshState();
  }

  window.setInterval(refreshState, POLL_INTERVAL_MS);
}

void initializeLiveView();
