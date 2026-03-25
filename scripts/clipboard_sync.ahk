; clipboard_sync.ahk
; 剪贴板同步到 VPS — Win + Shift + C 发送 / Win + Shift + V 从 VPS 拉取
;
; 依赖: curl (Win10/11 自带)
; 配置: 修改下方 API_URL 和 API_KEY

#NoEnv
#SingleInstance Force
SendMode Input

API_URL := "http://150.158.110.168:5001/api/clipboard"
API_KEY := ""  ; 填入 .env 中的 CLIPBOARD_API_KEY，留空则不鉴权

; ── Win + Shift + C : 推送剪贴板到 VPS ──────────────────
#+c::
    content := Clipboard
    if (content = "") {
        TrayTip, 剪贴板同步, 剪贴板为空，跳过, 1
        return
    }
    ; 转义 JSON 特殊字符
    content := StrReplace(content, "\", "\\")
    content := StrReplace(content, """", "\""")
    content := StrReplace(content, "`n", "\n")
    content := StrReplace(content, "`r", "")

    body := "{""content"":""" . content . """,""source"":""pc""}"
    cmd  := "curl -s -X POST """ . API_URL . """"
        . " -H ""Content-Type: application/json"""
        . " -H ""X-API-Key: " . API_KEY . """"
        . " -d """ . body . """"

    RunWait, %ComSpec% /c %cmd%, , Hide
    TrayTip, ✅ 剪贴板已同步, 内容已推送到 VPS, 1
return

; ── Win + Shift + V : 从 VPS 拉取到本机剪贴板 ────────────
#+v::
    tmpFile := A_Temp . "\clip_pull.json"
    cmd := "curl -s """ . API_URL . """"
         . " -H ""X-API-Key: " . API_KEY . """"
         . " -o """ . tmpFile . """"
    RunWait, %ComSpec% /c %cmd%, , Hide

    FileRead, raw, %tmpFile%
    FileDelete, %tmpFile%

    ; 简单提取 content 字段（避免依赖外部 JSON 库）
    RegExMatch(raw, """content""\s*:\s*""(.*?)(?<!\\)""", m)
    content := m1
    content := StrReplace(content, "\n", "`n")
    content := StrReplace(content, "\""", """")
    content := StrReplace(content, "\\", "\")

    if (content = "") {
        TrayTip, 剪贴板同步, VPS 上暂无内容, 1
        return
    }
    Clipboard := content
    TrayTip, 📋 已拉取, 内容已复制到本机剪贴板, 1
return
